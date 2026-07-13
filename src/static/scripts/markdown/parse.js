// *Very* ugly hack to make this work in both backend and frontend, but it does work.
let renderLinks = true;
if (typeof window === 'undefined') {
  var window = {
    postJSON: () => {},
  };
  renderLinks = false;
}
if (typeof exports === 'undefined') var exports = {};

if (!window.postJSON) throw 'fetchUtils.js not loaded!';

(function () {
  class BulkFetcher {
    constructor(url) {
      this.url = url;
      this.data = {};
      this.callbacks = [];
    }

    addCallback(cb) {
      this.callbacks.push(cb);
    }

    async fetch() {
      const result = await postJSON(this.url, this.data);
      this.callbacks.forEach(cb =>  cb(result));
      return result;
    }
  }
  
  const itemExistsCache = {};

  async function bulkCheckExists(universe, item, fetches, cb) {
    if (`${universe}/${item}` in itemExistsCache) {
      return cb(await itemExistsCache[`${universe}/${item}`]);
    }

    itemExistsCache[`${universe}/${item}`] = new Promise((resolve) => {
      if (!fetches.exists) {
        fetches.exists = new BulkFetcher('/api/exists');
      }
      if (!(universe in fetches.exists.data)) fetches.exists.data[universe] = [];
      fetches.exists.data[universe].push(item);
      fetches.exists.addCallback((result) => {
        cb(result[universe][item]);
        resolve(result[universe][item]);
      });
    });
  }

  class MarkdownNode {
    constructor(type, content, attrs={}) {
      this.type = type;
      this.content = content;
      this.attrs = attrs;
      this.children = [];
      this.parent = null;
      this.src = '';
    }

    addSrc(line) {
      this.src = this.src + `${this.src ? '\n' : ''}${line}`
    }

    addClass(cls) {
      const classList = this.attrs?.class?.split(' ') ?? [];
      classList.push(cls);
      const dups = {};
      this.attrs.class = classList.filter(c => {
        const isDup = dups[c];
        dups[c] = true;
        return !isDup;
      }).join(' ');
    }

    addChild(node) {
      this.children.push(node);
      node.parent = this;
      return node;
    }

    spliceChildren(index, deleteCount, ...nodes) {
      nodes.forEach(node => node.parent = this);
      return this.children.splice(index, deleteCount, ...nodes);
    }

    addChildren(nodes) {
      for (const node of nodes) {
        this.addChild(node);
      }
    }

    hasChildren() {
      return this.children.length > 0;
    }

    lastChild() {
      return this.hasChildren() ? this.children[this.children.length-1] : null;
    }

    innerText() {
      return `${this.content ?? ''}${this.children.map(child => child.innerText()).join('')}`;
    }

    async evaluate(currentUniverse, ctx, transform, topLevel=true, fetches={}) {
      if (this.type === 'a') {
        this.addClass('link');
        this.addClass('link-animated');
      }
      if (this.type === 'p' && this.children.length === 1 && this.children[0].type === 'img') {
        this.type = 'div';
        this.addClass('img-container');
        // return this.children[0].evaluate();
      }
      if ('href' in this.attrs) {
        if (this.attrs.href[0] === '@') {
          let [universe, itemHash] = this.attrs.href.substring(1).split('/');
          if (universe) {
            if (!itemHash) {
              itemHash = universe;
              universe = currentUniverse;
            }
            const item = itemHash.split('#')[0].split('?')[0];
            this.attrs['data-universe'] = universe;
            this.attrs['data-item'] = item;
            this.attrs['data-type'] = 'item-link';
            if (renderLinks) {
              this.attrs.href = `${universeLink(universe)}/items/${itemHash}`;
              bulkCheckExists(universe, item, fetches, (exists) => {
                this.attrs['data-exists'] = exists;
                if (!exists) this.addClass('link-broken');
              });
            }
          }
        } else {
          if (!this.attrs.href.startsWith('/') && !this.attrs.href.startsWith('#') && !this.attrs.href.startsWith(window.location?.origin)) {
            this.attrs.target = '_blank';
          }
        }
      }
      if (transform) transform(this);
      if (this.type === 'ctx') {
        for (const lookup of this.attrs.lookups) {
          const value = lookup.getValue(ctx);
          const content = this.content.replace('%', value);
          this.content = '';
          const nodes = parseInline(new Line(content));
          this.addChildren(nodes);
        }
      }
      if (this.attrs.ctx) {
        for (const attr in this.attrs.ctx) {
          let value = this.attrs.ctx[attr];
          if (value instanceof CtxLookup || value instanceof GalleryUrl) {
            value = value.getValue(ctx);
          }
          this.attrs[attr] = value;
        }
        delete this.attrs.ctx;
      }
      const result = [this.type, this.content ?? '', await Promise.all(this.children.map(tag => tag.evaluate(currentUniverse, ctx, transform, false, fetches))), this.attrs];
      if (topLevel) {
        await fetches.exists?.fetch();
      }
      return result;
    }
  }

  class CtxLookup {
    constructor(...lookup) {
      this.lookup = lookup;
      this.def;
    }

    default(def) {
      this.def = def;
      return this;
    }

    getValue(ctx) {
      let value = ctx;
      for (const key of this.lookup) {
        if (value && (key in value || (value instanceof Array && Number(key) < value.length))) value = value[key];
        else {
          value = this.def ?? `${this.lookup.join('.')}: not found.`;
          break;
        }
      }
      return value ?? this.def;
    }
  }

  class GalleryUrl {
    constructor(idLookup) {
      this.idLookup = idLookup;
    }

    getValue(ctx) {
      const id = this.idLookup.getValue(ctx);
      return `/api/universes/${ctx?.item?.universe_short}/items/${ctx?.item?.shortname}/gallery/images/${id}`;
    }
  }

  class Line {
    constructor(text) {
      this.text = text;
      this.index = 0;
    }

    next() {
      return this.text[this.index++];
    }

    peek(n=0) {
      return this.text[this.index+n];
    }

    hasNext() {
      return this.index < this.text.length;
    }

    hasPrevious() {
      return this.index - 1 > 0;
    }

    reset(index) {
      this.index = index;
    }
  }

  function inlineCmds(cmd, args) {
    if (cmd === 'data') {
      return new MarkdownNode('ctx', `%`, { lookups: [new CtxLookup('item', 'obj_data', ...args)], raw: { args } });
    } else if (cmd === 'tab') {
      return new MarkdownNode('ctx', `%`, { lookups: [new CtxLookup('item', 'obj_data', 'tabs', ...args)], raw: { args } });
    } else if (cmd === 'img') {
      const [src, alt, height, width] = args;
      const attrs = {
        ctx: {
          src: isNaN(Number(src)) ? src : new GalleryUrl(new CtxLookup('item', 'gallery', src, 'id')),
          title: alt || new CtxLookup('item', 'gallery', src, 'label').default(alt),
          alt: alt || new CtxLookup('item', 'gallery', src, 'name').default(alt),
        },
        raw: { args },
      };
      if (height) attrs.height = height;
      if (width) attrs.width = width;
      const node = new MarkdownNode('div', '');
      node.addClass('img-container');
      node.addChild(new MarkdownNode('img', '', attrs));
      return node;
    }

    return null;
  }

  function parseInline(line) {
    const nodes = [];
    let chunk = '';
    while (line.hasNext()) {
      const char = line.next();
      if (char === '\\') {
        chunk += line.next();
      } else if (char === '*' && line.peek() === '*') {
        nodes.push(new MarkdownNode('text', chunk));
        chunk = '';
        let boldChunk = '';
        const escaped = `${char}${line.next()}`
        let stars = 2;
        while (stars > 0 && line.hasNext()) {
          if (line.peek() === '*') {
            if (line.peek(1) !== '*' && stars === 2) stars += 1;
            else stars -= 1;
          } 
          if (stars >= 2) boldChunk += line.next();
          else line.next();
        }
        const boldNode = new MarkdownNode(
          stars === 0 ? 'b' : 'text',
          stars === 0 ? '' : escaped,
        );
        nodes.push(boldNode);
        boldNode.addChildren(parseInline(new Line(boldChunk)));
      } else if (char === '*' || char === '_') {
        nodes.push(new MarkdownNode('text', chunk));
        chunk = '';
        let italicsChunk = '';
        let stars = 1;
        while (stars > 0 && line.hasNext()) {
          if (line.peek() === '*' || line.peek() === '_') {
            if (line.peek() !== '_' && line.peek(1) === '*' && stars === 1) {
              stars += 2;
              italicsChunk += line.next();
            }
            else stars -= 1;
          } 
          if (stars >= 1) italicsChunk += line.next();
          else line.next();
        }
        const italicsNode = new MarkdownNode(
          stars === 0 ? 'i' : 'text',
          stars === 0 ? '' : char,
        );
        nodes.push(italicsNode);
        italicsNode.addChildren(parseInline(new Line(italicsChunk)));
      } else if (char === '[') {
        const isImage = line.peek(-2) === '!';
        const resetIndex = line.index;
        if (isImage) chunk = chunk.substring(0, chunk.length - 1);
        if (chunk) nodes.push(new MarkdownNode('text', chunk));
        chunk = '';
        while (!(line.peek() === ']' && line.peek(-1) !== '\\') && line.hasNext()) {
          chunk += line.next();
        }
        if (line.next() === ']' && line.next(1) === '(') {
          const lineNodes = parseInline(new Line(chunk));
          chunk = '';
          while (line.peek() !== ')' && line.hasNext()) {
            chunk += line.next();
          }
          if (line.next() === ')') {
            const linkNode = new MarkdownNode(isImage ? 'img' : 'a', '', { [isImage ? 'src' : 'href']: chunk });
            nodes.push(linkNode);
            if (isImage) linkNode.attrs.alt = lineNodes.map(node => node.innerText()).join('');
            else linkNode.addChildren(lineNodes);
            chunk = '';
          } else {
            chunk = '[';
            line.reset(resetIndex);
          }
        } else {
          chunk = '[';
          line.reset(resetIndex);
        }
      } else if (char === '@' && (line.peek(-2) === ' ' || !line.hasPrevious())) {
        if (chunk) nodes.push(new MarkdownNode('text', chunk));
        chunk = '';
        while (!(line.peek() === '@' && line.peek(-1) !== '\\') && line.hasNext()) {
          chunk += line.next();
        }
        line.next();
        const [cmd, ...args] = splitIgnoringQuotes(chunk);
        const cmdNode = inlineCmds(cmd, args);
        if (cmdNode) nodes.push(cmdNode);
        chunk = '';
      } else {
        chunk += char;
      }
    }
    if (chunk) nodes.push(new MarkdownNode('text', chunk));

    return nodes;
  }

  function splitIgnoringQuotes(str) {
    const regex = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;
    const matches = str.match(regex);
    return matches ? matches.map(match => match.replace(/^["']|["']$/g, '')) : [];
  }

  function parseMarkdown(text) {
    const root = new MarkdownNode('div', '', { class: 'markdown' });
    let toc;
    let maxTocDepth;
    let curParagraph = new MarkdownNode('p');
    let curList = [null, -1];
    let rootList = null;
    let curTocList = [null, -1];
    let asideStart = null;

    const lines = text.split('\n');
    for (const line of lines) {
      // console.log(line)
      const trimmedLine = line.trimStart();
      if (line[0] === '#') {
        let headingLvl = 0;
        while (line[headingLvl] === '#') headingLvl++;
        let j = headingLvl;
        let id;
        if (line[headingLvl] === '(') {
          while (line[j] !== ')' && j < line.length) j++;
          id = line.substring(headingLvl+1, j);
          j++;
        }
        if (line[j] === ' ') {
          const heading = root.addChild(new MarkdownNode(`h${headingLvl}`));
          heading.addChildren(parseInline(new Line(line.substring(j+1))));
          if (!id) {
            id = heading.innerText().toLowerCase().replaceAll(' ', '-');
          }
          heading.attrs.id = id;
          heading.addSrc(line);
          if (!toc) continue;
          if (maxTocDepth && headingLvl > maxTocDepth) continue;
          const [lastListNode, lastHeadingLvl] = curTocList;
          if (headingLvl > lastHeadingLvl) {
            const lastListItem = lastListNode ? (lastListNode.lastChild() ?? lastListNode.addChild(new MarkdownNode('li'))) : null;
            const newListNode = (lastListItem ?? toc).addChild(new MarkdownNode('ol'));
            curTocList = [newListNode, headingLvl];
          } else if (headingLvl < lastHeadingLvl) {
            let newListNode = lastListNode;
            for (i = 0; i < lastHeadingLvl - headingLvl; i++) {
              if (newListNode.parent.parent.type === 'ol') newListNode = newListNode.parent.parent;
              else break;
            }
            curTocList = [newListNode, headingLvl];
          }
          const [curListNode] = curTocList;
          curListNode.addChild(new MarkdownNode('li'));
          const tocLink = new MarkdownNode('a', heading.innerText(), { href: `#${id}` });
          curListNode.lastChild().addChild(tocLink);
        }
      } else if (trimmedLine[0] === '@') {
        const lineEnd = trimmedLine.length - (trimmedLine[trimmedLine.length - 1] === '@' ? 1 : 0)
        const [cmd, ...args] = splitIgnoringQuotes(trimmedLine.substring(1, lineEnd));
        if (cmd === 'toc') {
          toc = root.addChild(new MarkdownNode('div', '', { id: 'toc' }));
          toc.addChild(new MarkdownNode('h3', 'Table of Contents'));
          if (args.length >= 1) maxTocDepth = args[0];
          toc.addSrc(`@${cmd}`);
        } else if (cmd === 'aside') {
          asideStart = root.children.length;
        } else if (cmd === 'aside-end' && asideStart !== null) {
          const boxNodes = root.spliceChildren(asideStart, root.children.length)
          const box = new MarkdownNode('aside', '');
          root.spliceChildren(asideStart, 0, box);
          box.addChildren(boxNodes);
          box.addSrc('@aside\n');
          box.addSrc(boxNodes.map(node => node.src).join('\n\n'));
          box.addSrc('\n@aside-end');
        } else {
          const cmdNode = inlineCmds(cmd, args);
          if (cmdNode) {
            root.addChild(cmdNode);
            cmdNode.addSrc(`@${[cmd, ...args].join(' ')}`);
          }
        }
      } else if (trimmedLine[0] === '-' && trimmedLine[1] === ' ') {
        const indent = (line.length - trimmedLine.length) / 2;
        const [lastListNode, lastIndent] = curList;
        if (lastIndent === -1 && curParagraph.hasChildren()) {
          curParagraph.type = 'span';
          curParagraph.addClass('list-label');
          root.addChild(curParagraph);
          curParagraph = new MarkdownNode('p');
        }
        if (indent > lastIndent) {
          const lastListItem = lastListNode ? (lastListNode.lastChild() ?? lastListNode.addChild(new MarkdownNode('li'))) : null;
          const newListNode = (lastListItem ?? root).addChild(new MarkdownNode('ul'));
          if (!lastListItem) rootList = newListNode;
          curList = [newListNode, indent];
        } else if (indent < lastIndent) {
          let newListNode = lastListNode;
          for (i = 0; i < lastIndent - indent; i++) newListNode = newListNode.parent.parent;
          curList = [newListNode, indent];
        }
        const [curListNode] = curList;
        curListNode.addChild(new MarkdownNode('li'));
        curListNode.lastChild().addChildren(parseInline(new Line(trimmedLine.substring(2))));
        rootList.addSrc(line);
      } else if (trimmedLine === '') {
        if (curParagraph.hasChildren()) root.addChild(curParagraph);
        curParagraph = new MarkdownNode('p');
        curList = [null, -1];
      } else {
        curParagraph.addChildren(parseInline(new Line(line), root));
        curParagraph.addSrc(line);
      }
    }
    if (curParagraph.hasChildren()) root.addChild(curParagraph);

    return root;
  }

  function _extractLinks(data) {
    const [,, children, attrs] = data;
    const links = [];
    if ('data-type' in attrs && attrs['data-type']) {
      links.push([attrs['data-universe'], attrs['data-item'], attrs.href]);
    }
    return [ ...links, ...children.reduce((acc, child) => ([ ...acc, ..._extractLinks(child) ]), []) ];
  }

  async function extractLinks(universeShortname, body, ctx) {
    try {
      const tree = parseMarkdown(body);
      const links = _extractLinks(await tree.evaluate(universeShortname, ctx));
      return links;
    } catch (err) {
      console.error(err);
      return [];
    }
  }

  window.parseMarkdown = parseMarkdown;
  exports.extractLinks = extractLinks;
})();
