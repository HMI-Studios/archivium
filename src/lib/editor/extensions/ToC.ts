import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import { TiptapContext } from '..';
import { slugify } from './Heading';

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
