import { Editor, InputRule, mergeAttributes } from '@tiptap/core';
import TiptapLink, { LinkOptions } from '@tiptap/extension-link';
import { MarkType } from '@tiptap/pm/model';
import { TiptapContext } from '..';

export interface ResolveResult {
  href: string;
  exists?: boolean;
}

export type ShorthandResolver = (shorthand: string, context: TiptapContext | undefined) => ResolveResult;

interface ExtendedLinkOptions extends LinkOptions {
  shorthandResolver: ShorthandResolver;
  context?: TiptapContext;
}

const MD_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)$/;

async function revalidateShorthandLink(editor: Editor | undefined, type: MarkType, href: string, context?: TiptapContext) {
  if (!editor || !context?.resolveItemExists) return;
  await context.resolveItemExists(href);
  if (editor.isDestroyed) return;

  const { state } = editor;
  const tr = state.tr;
  let touched = false;
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find(m => m.type === type && m.attrs.href === href);
    if (mark) {
      tr.addMark(pos, pos + node.nodeSize, type.create({ ...mark.attrs, _revalidated: (mark.attrs._revalidated ?? 0) + 1 }));
      touched = true;
    }
  });
  if (touched) {
    tr.setMeta('addToHistory', false);
    editor.view.dispatch(tr);
  }
}

const Link = TiptapLink.configure({
  autolink: true,
  HTMLAttributes: {
    rel: '',
    target: '',
    class: 'link link-animated',
  },
}).extend<ExtendedLinkOptions>({
  addOptions() {
    const parent = (this.parent?.() as LinkOptions) ?? {};
    return {
      ...parent,
      shorthandResolver: (s: string) => ({ href: s, pending: true }),
    };
  },

  addAttributes() {
    return {
      href: {
        parseHTML: element => element.getAttribute('data-href') ?? element.getAttribute('href'),
      },
      title: {
        default: null,
      },
      _revalidated: {
        default: 0,
        rendered: false,
      },
    }
  },

  renderHTML({ HTMLAttributes }) {
    const resolved: ResolveResult = this.options.shorthandResolver(HTMLAttributes.href, this.options.context);

    const href = resolved.href;
    const exists = resolved.exists as boolean ?? true;

    return [
      'a',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        href,
        class: exists ? '' : 'link-broken',
        'data-href': HTMLAttributes.href,
      }),
      0,
    ];
  },

  addInputRules() {
    const type = this.type;
    const editor = this.editor;
    const context = this.options.context;
    return [
      new InputRule({
        find: MD_LINK_RE,
        handler({ state, range, match }) {
          const [, label, target] = match;
          if (!label || !target) return null;

          const tr = state.tr;
          tr.insertText(label, range.from, range.to);
          tr.addMark(range.from, range.from + label.length, type.create({ href: target }));
          tr.removeStoredMark(type);

          if (target.startsWith('@')) {
            revalidateShorthandLink(editor, type, target, context);
          }
        }
      }),
    ]
  },
});

export default Link;
