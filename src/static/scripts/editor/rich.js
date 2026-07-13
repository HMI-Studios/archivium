/**
 * Rich Text Editor
 * 
 * TODO this isn't quite working right yet - it's being
 * shelved for now in favor of the enhanced markdown editor.
 */

if (!window.createElement) throw 'domUtils.js not loaded!';
if (!window.createSearchableSelect) throw 'searchableSelect.js not loaded!';
if (!window.parseMarkdown) throw 'markdown/parse.js not loaded!';
if (!MarkdownElement) throw 'markdown/render.js not loaded!';

const ELEMENT_NODE = 1;
function serializeElement(element) {

  if (element.nodeType === ELEMENT_NODE) {
    const children = [];
    const dataset = {};
    const attrs = {};

    for (const attr of element.attributes) {
      attrs[attr.name] = attr.value;
    }

    for (const key in element.dataset) {
      dataset[key] = element.dataset[key];
    }

    for (const child of element.childNodes) {
      children.push(serializeElement(child));
    }

    return [element.tagName.toLowerCase(), children.length ? '' : element.innerText, children, attrs];
  } else {
    return ['text', element.nodeValue, [], {}];
  }

}

function selectTextBehindCaret(charsBehind) {
  let selection = window.getSelection();

  if (selection.rangeCount > 0) {
    let range = selection.getRangeAt(0);
    let startOffset = range.startOffset;
    let newOffset = Math.max(startOffset - charsBehind, 0);
    
    range.setStart(range.startContainer, newOffset);
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    console.log('No selection found.');
  }
}

function replaceSelectionWithEl(el) {
  let selection = window.getSelection();

  if (selection.rangeCount > 0) {
    let range = selection.getRangeAt(0);

    range.deleteContents();
    range.insertNode(el);

    let newRange = document.createRange();
    newRange.setStartAfter(el);
    selection.removeAllRanges();
    selection.addRange(newRange);
  }
}

class EditorNode extends MarkdownElement {
  constructor(...args) {
    super(...args);
    this.handle = null;
  }

  save() {
    this.parent.save();
  }

  getHref() {
    if (!this.attrs.href) return '';
    if ('universe' in this.dataset && 'item' in this.dataset) {
      if (this.dataset.universe === window.contextUniverse.shortname) return `@${this.dataset.item}`;
      else return `@${this.dataset.universe}/${this.dataset.item}`;
    } else {
      return this.attrs.href;
    }
  }

  export() {
    if (this.type === 'img') {
      const isAlone = this.parent.classes.includes('img-container');
      let suf = isAlone ? '' : '@';
      let pref = isAlone ? '\n' : '';
      if (this.attrs.raw) return `${pref}@img ${this.attrs.raw.args.join(' ')}${suf}`;
      else return `![${this.attrs.alt}](${this.attrs.src})`;
    } else if (this.attrs.id === 'toc') {
      return `\n@toc`;
    } else {
      const content = this.children.map(child => child.export()).join('') + (this.content ?? '');
      const surround = {
        b: '**',
        strong: '**',
        i: '_',
        em: '_',
      }[this.type] ?? '';
      const pref = {
        ul: '\n',
        p: '\n',
        h1: '\n# ',
        h2: '\n## ',
        h3: '\n### ',
        h4: '\n#### ',
        h5: '\n##### ',
        h6: '\n###### ',
        aside: '\n@aside\n',
        li: '\n- ',
        a: '[',
      }[this.type] ?? '';
      const suf = {
        p: '\n',
        aside: '\n\n@aside-end\n',
        a: `](${this.getHref()})`,
      }[this.type] ?? '';
      let result = `${pref}${surround}${content}${surround}${suf}`;
      return result;
    }
  }

  move(steps) {
    const index = this.parent.children.indexOf(this);
    this.parent.children.splice(index, 1);
    this.parent.children.splice(index + steps, 0, this);
    this.parent.render();
    this.save();
  }

  addBelow() {
    const index = this.parent.children.indexOf(this);
    this.parent.children.splice(index + 1, 0, new this.constructor(this.parent, ['p', '', [], {}], { ...this.meta }));
    this.parent.render();
  }

  getHandle() {
    let hasHandle = !this.isInline();

    hasHandle |= this.attrs.id === 'toc';
    hasHandle &= !this.meta.isToc;

    if (this.type === 'div' && this.attrs.id !== 'toc') {
      hasHandle &= this.classes.includes('img-container');
    }

    const offset = (
      this.type === 'li'
    ) ? '-4.25rem' : '-3.25rem';
    const offsetType = this.type === 'aside' ? 'flex-direction: row-reverse; right': 'left';

    if (hasHandle) {
      const innerDiv = createElement('div', { children: [
        createElement('button', { attrs: { innerText: '+', onclick: this.addBelow.bind(this) } }),
        createElement('button', { attrs: { innerText: '↑', onclick: this.move.bind(this, -1) } }),
        createElement('button', { attrs: { innerText: '↓', onclick: this.move.bind(this, 1) } }),
      ]});
      const el = createElement('div', {
        attrs: { style: `${offsetType}: ${offset};`, contentEditable: false },
        classList: ['editor-handle'],
        children: [ innerDiv ],
      });

      innerDiv.onmouseenter = (e) => {
        this.innerEl?.classList.add('selected');
      };
      innerDiv.onmouseleave = (e) => {
        this.innerEl?.classList.remove('selected');
      };

      return el;
    }
  }

  isInline() {
    return !({
      p: true,
      li: true,
      aside: true,
      div: true,
      h1: true,
      h2: true,
      h3: true,
      h4: true,
      h5: true,
      h6: true,
    }[this.type]);
  }

  isEditable() {
    return !({
      ul: true,
      div: true,
      aside: true,
      a: true,
      // span: this.meta.isLink,
    }[this.type] || this.attrs.id === 'toc' || this.meta.isToc);
  }

  makeElement() {
    this.attrs.contentEditable = this.isEditable();
    const innerEl = super.makeElement();
    const handle = this.getHandle();

    if (this.isEditable()) {
      innerEl.ondeselect = () => {
        // this.parent.render();
        this.save();
      };

      innerEl.oninput = () => {
        this.update(serializeElement(innerEl), this.meta);
      };

      let cmdMode = false;
      let cmd = '';
      innerEl.onkeydown = (e) => {
        if (e.ctrlKey) {
          if (e.key === 'b') {
            e.preventDefault();
            document.execCommand('bold');
            this.innerEl.oninput();
          } else if (e.key === 'i') {
            e.preventDefault();
            document.execCommand('italic');
            this.innerEl.oninput();
          }
        }
        if (cmdMode) {
          if (e.code === 'Backspace') {
            cmd = cmd.substring(0, cmd.length - 1);
          } else if (e.code === 'Space') {
            selectTextBehindCaret(cmd.length + 1);
            e.preventDefault();
            replaceSelectionWithEl(createElement('a', { classList: ['link', 'link-animated'], attrs: {
              href: `@${cmd}`,
              innerText: cmd,
            }, dataset: {
              universe: window.contextUniverse.shortname,
              item: cmd,
            }}));
            cmdMode = false;
            this.innerEl.oninput();
          } else {
            cmd += e.key;
          }
        } else if (e.key === '@') {
          cmdMode = true;
          cmd = '';
        }
      };
    }

    if (handle) {
      this.handle = handle;
      this.innerEl = innerEl;
      this.element = createElement('div', { children: [ handle, innerEl ]});
    }
    else this.element = innerEl;
    return this.element;
  }

  getElement() {
    return this.innerEl ?? super.getElement();
  }
  
  postRender() {
    if (this.handle) {
      const { marginTop, paddingTop, marginRight } = window.getComputedStyle(this.innerEl);
      this.handle.style.top = `calc(${marginTop ?? 0} + ${paddingTop ?? 0})`;
      if (this.handle.style.right) {
        this.handle.style.right = `calc(${this.handle.style.right} + ${marginRight ?? 0})`;
      }
    }
    this.children.forEach(child => child.postRender());
  }

  render() {
    super.render();
    this.postRender();
  }
}

async function loadRichEditor(universe, body) {

  function addFocusHandlers(editor) {
    editor.addEventListener(
      'focusin',
      (e) => {
        e.target.classList.add('selected');
      },
      true,
    );
    editor.addEventListener(
      'focusout',
      (e) => {
        e.target.classList.remove('selected');
        e.target.ondeselect && e.target.ondeselect();
      },
      true,
    );
  }

  const saves = [];

  window.contextUniverse = universe;
  const editor = document.getElementById('editor');
  if (editor) {
    editor.classList.add('markdown');
    editor.classList.add('rich-editor');
    const nodes = new EditorNode({ getElement: () => editor, save }, await parseMarkdown(body).evaluate(universe.shortname, { item: window.item }));
    nodes.render();
    addFocusHandlers(editor);
    saves.push(() => {
      const markdown = nodes.export().trim();
      window.item.obj_data.body = markdown;
    });
  } else {
    console.warn('Editor div not found!');
  }

  document.querySelectorAll('.editableKey').forEach(async (container) => {
    const { tabName, key, val } = container.dataset;
    const keyEditor = createElement('div');
    const valEditor = createElement('div');
    container.appendChild(keyEditor);
    container.appendChild(createElement('hr'));
    container.appendChild(valEditor);
    const valData = await parseMarkdown(val).evaluate(universe.shortname, null, (tag) => {
      if (tag.type === 'div') tag.attrs.style = {'text-align': 'right'};
      if (tag.type === 'p') tag.type = 'span';
    });
    const keyNodes = new EditorNode({ getElement: () => keyEditor, save }, ['span', key, [], {}]);
    const valNodes = new EditorNode({ getElement: () => valEditor, save }, valData);
    keyNodes.render();
    valNodes.render();
    addFocusHandlers(keyEditor);
    addFocusHandlers(valEditor);
    saves.push(() => {
      if (window.item.obj_data.tabs[tabName] && window.item.obj_data.tabs[tabName][key]) {
        const newKey = keyNodes.export().trim();
        delete window.item.obj_data.tabs[tabName][key];
        window.item.obj_data.tabs[tabName][newKey] = valNodes.export().trim();
      }
    });
  });
  document.querySelectorAll('.editableLabel').forEach(async (container) => {
    const { index, label } = container.dataset;
    const labelEditor = createElement('div');
    container.appendChild(labelEditor);
    const data = await parseMarkdown(label).evaluate(universe.shortname, null, (tag) => {
      if (tag.type === 'div') {
        tag.attrs.style = {'text-align': 'center'};
        tag.attrs.class += ' label';
      }
      if (tag.type === 'p') tag.type = 'span';
    });
    const labelNodes = new EditorNode(
      {
        getElement: () => labelEditor,
        save,
      },
      ['div', '', [label ? data : ['span', '', [], {}]], { class: 'label' }],
    );
    labelNodes.render();
    addFocusHandlers(labelEditor);
    delete window.item.obj_data.gallery.imgs[index].mdLabel;
    saves.push(() => {
      if (window.item.obj_data.gallery?.imgs[index]) {
        window.item.obj_data.gallery.imgs[index].label = labelNodes.export().trim();
      }
    });
  });

  async function save(submit=true) {
    for (const f of saves) {
      f();
    }

    console.log(JSON.stringify(item, null, 1).replaceAll('\\n', '\n'));

    if (submit) {
      // await fetch(`/api/universes/${universe}/items/${window.item.shortname}`, {
      //   method: 'PUT',
      //   headers: {
      //   'Content-Type': 'application/json',
      //   },
      //   body: JSON.stringify({ ...window.item }),
      // });
    }
  }

  save(false);
}