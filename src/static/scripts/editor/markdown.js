/**
 * Enhanced Markdown Editor
 * 
 * Built as a middle ground between the original markdown editor and the problematic rich editor.
 * It still has issues, mainly with selecting multiple paragraphs,
 * but fixing those will probably require starting over from scratch again.
 */

if (!window.createElement) throw 'domUtils.js not loaded!';
if (!window.createSearchableSelect) throw 'searchableSelect.js not loaded!';
if (!window.parseMarkdown) throw 'markdown/parse.js not loaded!';
if (!MarkdownElement) throw 'markdown/render.js not loaded!';
if (!window.putJSON) throw 'fetchUtils.js not loaded!';
if (!window.modal) throw 'modal not loaded!';

(function() {
  function preserveCaretPosition(el, callback) {
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;
  
    callback();
  
    const newRange = document.createRange();
    newRange.setStart(el.firstChild, startOffset);
    newRange.setEnd(el.firstChild, endOffset);
    selection.removeAllRanges();
    selection.addRange(newRange);
  }

  class EditorRowNode {
    constructor(editor, row, insertAfter=null) {
      this.editor = editor;
      this.renderedEl = createElement('div', { attrs: { contentEditable: false } });
      if (insertAfter) {
        insertAfter.currentEl.insertAdjacentElement('afterend', this.renderedEl);
      } else {
        this.editor.container.appendChild(this.renderedEl);
      }
      this.currentEl = this.renderedEl;
      this.focused = false;
      this.src = row.src;
      
      if (this.src !== '@toc') {
        this.rawEl = createElement('div', { attrs: { contentEditable: true, innerText: this.src }, classList: ['selected'] });

        this.renderedEl.onclick = async (e) => {
          e.stopPropagation();
          await this.editor.select(this, e.shiftKey);
        };

        this.rawEl.onclick = (e) => {
          e.stopPropagation();
        };

        this.rawEl.addEventListener('input', (e) => {
          this.editor.onchange();
          if (e.inputType === 'insertParagraph' && this.editor.isSingleLine) {
            preserveCaretPosition(this.rawEl, () => {
              this.rawEl.innerText = this.rawEl.innerText.replaceAll('\n', '');
            });
            this.unfocus();
            return;
          }
          if (
            e.inputType === 'insertText'
            || e.inputType === 'insertFromPaste'
            || e.inputType === 'insertParagraph'
            || e.inputType === 'deleteContentBackward'
          ) {
            this.setSrc(this.rawEl.innerText, false);
          } else {
            preserveCaretPosition(this.rawEl, () => {
              this.rawEl.innerText = this.rawEl.innerText;
            });
          }
        });

        this.rawEl.addEventListener('paste', (e) => {
          e.preventDefault();
          const text = (e.clipboardData || window.clipboardData).getData('text');
          document.execCommand('insertText', false, text); // TODO replace this later
        });
      }

      row.evaluate(window.contextUniverse.shortname, { item: window.item }).then((data) => {
        this.node = new MarkdownElement({ getElement: () => this.renderedEl }, data);
        this.render();
      });
    }

    getSrc() {
      return this.src;
    }

    setSrc(src, reset=true) {
      this.src = src;
      if (reset) this.rawEl.innerText = this.src;
    }

    async parse(src) {
      const rows = parseMarkdown(src).children;
      let refNode = this;
      rows.splice(1).forEach(row => {
        refNode = this.editor.addBelow(refNode, row);
      })
      const row = rows[0];
      if (!row) return false;
      this.setSrc(row.src);
      const data = await row.evaluate(window.contextUniverse.shortname, { item: window.item });
      this.node.update(data);
      return true;
    }

    focus() {
      if (!this.focused) {
        this.editor.container.replaceChild(this.rawEl, this.currentEl);
        this.currentEl = this.rawEl;
        this.focused = true;
        this.rawEl.focus();
      }
    }

    async unfocus() {
      if (this.focused) {
        const notEmpty = await this.parse(this.getSrc());
        if (notEmpty) {
          try {
            this.editor.container.replaceChild(this.renderedEl, this.currentEl);
            this.currentEl = this.renderedEl;
            this.render();
            this.focused = false;
          } catch (err) {}
        } else {
          this.editor.delete(this);
        }
      }
    }

    render() {
      this.node.render();
    }

    remove() {
      this.currentEl = null;
      this.renderedEl.remove();
      this.rawEl.remove();
    }
  } 

  class Editor {
    constructor(container, body, onchange, isSingleLine=false) {
      container.classList.add('markdown');
      container.classList.add('md-editor');
      if (isSingleLine) container.classList.add('single-line');
      container.onmousedown = (e) => {
        e.stopPropagation();
        if (this.nodes.length === 0) {
          const node = new EditorRowNode(this, parseMarkdown(''));
          this.nodes.push(node);
          this.select(node);
        }
      };
      this.container = container;
      const rows = parseMarkdown(body).children;
      this.nodes = rows.map((row) => new EditorRowNode(this, row));
      // if (this.nodes.length === 0) 
      this.selected = null;
      this.onchange = onchange;
      this.isSingleLine = isSingleLine;
    }

    async select(node, multi) {
      if (multi && this.selected) {
        if (!this.selected.focused) this.selected.focus();
        const diff = this.nodes.indexOf(node) - this.nodes.indexOf(this.selected)
        const dist = Math.abs(diff);
        const dir = Math.sign(diff);
        let start = this.nodes.indexOf(this.selected);
        for (let i = 0; i < dist; i++) {
          const curNode = this.nodes[start + dir];
          const newSrc = dir > 0 ? `${this.selected.getSrc()}\n\n${curNode.getSrc()}` : `${curNode.getSrc()}\n\n${this.selected.getSrc()}`;
          this.selected.setSrc(newSrc);
          this.delete(curNode);
          if (dir < 0) start--;
        }
      } else {
        await this.unfocusAll();
        this.selected = node;
        this.selected.focus();
      }
    }

    addBelow(node, row) {
      const i = this.nodes.indexOf(node);
      const newNode = new EditorRowNode(this, row, node);
      this.nodes.splice(i + 1, 0, newNode);
      return newNode;
    }

    delete(node) {
      const i = this.nodes.indexOf(node);
      this.nodes.splice(i, 1);
      node.remove();
    }

    export() {
      return this.nodes.map(node => node.getSrc()).join('\n\n');
    }

    async unfocusAll() {
      this.selected = null;
      await Promise.all(this.nodes.map(node => node.unfocus()));
    }
  }
  
  function saveFns(changeCheck, doSave) {
    return { changeCheck, doSave };
  }

  async function loadEditor(universe, body) {

    let needsSaving = false;
    window.onbeforeunload = (event) => {
      if (needsSaving) {
        event.preventDefault();
        event.returnValue = true;
      }
    };
    
    const saves = [];
    let saveTimeout = null;
    function save(timeout=5000) {
      const saveBtn = document.getElementById('save-btn');
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      saveBtn.firstChild.innerText = 'Saving...';
      saveTimeout = setTimeout(async () => {
        console.log('SAVING...');
        const changes = saves.map(fns => fns.changeCheck());
        if (!changes.some(v => v)) {
          console.log('NO CHANGE');
          saveBtn.firstChild.innerText = 'Saved';
          needsSaving = false;
          return;
        }
        const data = {};
        for (const key of changes) {
          if (key in data) continue;
          data[key] = window.item.obj_data[key];
        }
        try {
          const data = {};
          const promises = saves.filter((_, i) => changes[i]).map(fns => fns.doSave(data));
          await Promise.all(promises);
          if (Object.keys(data).length > 0) {
            await putJSON(`/api/universes/${universe.shortname}/items/${window.item.shortname}/data`, data);
          }
          console.log('SAVED.');
          saveBtn.firstChild.innerText = 'Saved';
          needsSaving = false;
        } catch (err) {
          console.error('Failed to save!');
          console.error(err);
          saveBtn.firstChild.innerText = 'Error';
          for (const key in data) {
            window.item.obj_data[key] = null;
          }
        }
      }, timeout);
    }
    function onchange() {
      needsSaving = true;
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      const saveBtn = document.getElementById('save-btn');
      saveBtn.firstChild.innerText = 'Save';
      saveBtn.classList.remove('hidden');
    }

    window.contextUniverse = universe;
    const editors = [];
    const editorDiv = document.getElementById('editor');
    if (editorDiv) {
      const editor = new Editor(editorDiv, body, onchange);
      editors.push(editor);
      window.onmousedown = () => {
        editors.forEach(e => e.unfocusAll());
        save();
      };
      window.editorObj = editor;
      saves.push(saveFns(() => {
        const markdown = editor.export().trim();
        if (markdown === window.item.obj_data.body) return false;
        window.item.obj_data.body = markdown;
        return true;
      }, (data) => {
        data.body = window.item.obj_data.body;
      }));
      document.getElementById('save-btn').onclick = () => {
        save(0);
      };
    } else {
      console.warn('Editor div not found!');
    }

    // Tabs
    document.querySelectorAll('.editableKey').forEach(async (container) => {
      const { tabName, key, val } = container.dataset;
      const keyEditorDiv = createElement('div');
      const valEditorDiv = createElement('div');
      container.appendChild(keyEditorDiv);
      container.appendChild(createElement('hr'));
      container.appendChild(valEditorDiv);
      const keyEditor = new Editor(keyEditorDiv, key, onchange, true);
      editors.push(keyEditor);
      const valEditor = new Editor(valEditorDiv, val, onchange, true);
      editors.push(valEditor);
      let curKey = key;
      let curVal = val;
      saves.push(saveFns(() => {
        if (!window.item.obj_data.tabs[tabName] || !window.item.obj_data.tabs[tabName][key]) return false;
        const newKey = keyEditor.export().trim();
        const newVal = valEditor.export().trim();
        if (newKey === curKey && newVal === curVal) return false;
        curKey = newKey;
        curVal = newVal;
        delete window.item.obj_data.tabs[tabName][key];
        window.item.obj_data.tabs[tabName][newKey] = newVal;
        return true;
      }, (data) => {
        if (!data.tabs) data.tabs = [];
        if (!data.tabs[tabName]) data.tabs[tabName] = [];
        data.tabs[tabName][curKey] = window.item.obj_data.tabs[tabName][curKey];
      }));
    });

    // Gallery Labels
    document.querySelectorAll('.editableLabel').forEach(async (container) => {
      const { index, label } = container.dataset;
      const labelEditorDiv = createElement('div');
      container.appendChild(labelEditorDiv);
      const labelEditor = new Editor(labelEditorDiv, label, onchange, true);
      editors.push(labelEditor);
      let curLabel = label;
      saves.push(saveFns(() => {
        if (!window.item.gallery[index]) return false;
        const newLabel = labelEditor.export().trim();
        if (newLabel === curLabel) return false;
        curLabel = newLabel;
        window.item.gallery[index][2] = newLabel;
        return true;
      }, async (_) => {
        const id = window.item.gallery[index][0];
        await putJSON(`/api/universes/${universe.shortname}/items/${window.item.shortname}/gallery/images/${id}`, { label: curLabel });
      }));
    });
  }
  window.loadEditor = loadEditor;
})();