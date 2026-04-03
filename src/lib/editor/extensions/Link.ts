import { InputRule, mergeAttributes } from '@tiptap/core';
import TiptapLink, { LinkOptions } from '@tiptap/extension-link';
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
        parseHTML: element => element.getAttribute('data-href'),
      }
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
        }
      }),
    ]
  },
});

export default Link;
