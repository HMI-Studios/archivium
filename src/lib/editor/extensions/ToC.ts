import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import { DOMSerializer, Node as PMNode } from '@tiptap/pm/model';
import { TiptapContext } from '..';
import { slugify } from './Heading';

type HeadingEntry = { title: string, level: number };

function computeLiveTocData(doc: PMNode): { headings: HeadingEntry[], scopedByPos: Map<number, HeadingEntry[]> } {
  const headings: HeadingEntry[] = [];
  const scopedByPos = new Map<number, HeadingEntry[]>();
  const stack: { level: number, headings: HeadingEntry[], tocPositions: number[] }[] = [];

  function closeSectionsAtOrAbove(level: number) {
    while (stack.length && stack[stack.length - 1].level >= level) {
      const section = stack.pop()!;
      for (const pos of section.tocPositions) {
        scopedByPos.set(pos, section.headings);
      }
    }
  }

  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const level = node.attrs.level ?? 1;
      const title = node.textContent;
      closeSectionsAtOrAbove(level);
      if (title) {
        headings.push({ title, level });
        for (const section of stack) section.headings.push({ title, level });
      }
      stack.push({ level, headings: [], tocPositions: [] });
    } else if (node.type.name === 'toc' && stack.length > 0) {
      stack[stack.length - 1].tocPositions.push(pos);
    }
  });

  closeSectionsAtOrAbove(-Infinity);
  return { headings, scopedByPos };
}

export interface ToCOptions {
  HTMLAttributes: Record<string, any>
  context?: TiptapContext;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toc: {
      insertToC: () => ReturnType
    }
  }
}

function generateToCDOM(headings: { title: string, level: number }[]): any {
  if (!headings.length) return ['p', { style: 'margin-top: -1rem; margin-bottom: 0;' }, '. . .'];

  const root: any[] = ['ol', {}];
  let stack: any[][] = [root];
  let currentLevel = headings[0].level;

  for (const { title, level } of headings) {
    while (currentLevel < level) {
      const newList: any[] = ['ol', {}];
      stack[stack.length - 1].push(newList);
      stack.push(newList);
      currentLevel++;
    }

    while (currentLevel > level && stack.length > 1) {
      stack.pop();
      currentLevel--;
    }

    stack[stack.length - 1].push(['li', { class: `toc-level-${level}` }, ['a', { class: 'link link-animated', href: `#${slugify(title)}` }, title]]);
  }

  return root;
}

const ToC = Node.create<ToCOptions>({
  name: 'toc',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {
        class: 'toc',
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div#toc' }]
  },

  addAttributes() {
    return {
      scopedHeadings: {
        default: null,
        rendered: false,
      },
    }
  },

  renderHTML({ node, HTMLAttributes }) {
    const headings = node.attrs.scopedHeadings ?? this.options.context?.headings;

    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      ['h3', {}, 'Table of Contents'],
      ...(headings ? [generateToCDOM(headings)] : []),
    ];
  },

  addCommands() {
    return {
      insertToC: () =>
        ({ commands }) => commands.insertContent({ type: this.name }),
    }
  },

  addNodeView() {
    const options = this.options;
    return ({ editor, getPos, HTMLAttributes }) => {
      const dom = document.createElement('div');
      const attrs = mergeAttributes(options.HTMLAttributes, HTMLAttributes);
      for (const [key, value] of Object.entries(attrs)) {
        if (value != null) dom.setAttribute(key, String(value));
      }

      const heading = document.createElement('h3');
      heading.textContent = 'Table of Contents';
      dom.appendChild(heading);

      let listEl: HTMLElement | null = null;

      const render = () => {
        const pos = getPos();
        if (pos === undefined) return;
        const { headings, scopedByPos } = computeLiveTocData(editor.state.doc);
        const list = scopedByPos.get(pos) ?? headings;
        const rendered = DOMSerializer.renderSpec(document, generateToCDOM(list)).dom as HTMLElement;
        if (listEl) dom.replaceChild(rendered, listEl);
        else dom.appendChild(rendered);
        listEl = rendered;
      };

      render();
      editor.on('update', render);

      return {
        dom,
        update: (updatedNode) => updatedNode.type.name === 'toc',
        destroy: () => editor.off('update', render),
      };
    };
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /^@toc$/,
        type: this.type,
      }),
    ]
  },
});

export default ToC;
