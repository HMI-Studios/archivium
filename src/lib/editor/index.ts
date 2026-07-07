import { Extendable } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import Aside from './extensions/Aside';
import Image from './extensions/Image';
import Link, { ResolveResult } from './extensions/Link';
import ToC from './extensions/ToC';
import Heading from './extensions/Heading';
import IFrame from './extensions/IFrame';
import Mention from './extensions/Mention';
import { HocuspocusProvider } from '@hocuspocus/provider';

import * as Y from 'yjs';

export interface TiptapContext {
  currentUniverse: string;
  universeLink: (universe: string) => string;
  itemExists: (universe: string, item: string) => boolean;
  headings: { title: string, level: number }[],
  items?: () => Record<string, { title: string, tags?: string[] }>;
}

export type LinkData = {
  universe?: string,
  item?: string,
  hash?: string,
  query?: string,
};

export function extractLinkData(href: string): LinkData {
  const data: LinkData = {};

  if (href.startsWith('@')) {
    let [first, second] = href.substring(1).split('/');
    if (first) {
      data.universe = first;
      if (!second) {
        second = first;
        delete data.universe;
      }

      const [itemQuery, hash] = second.split('#');
      const [item, query] = itemQuery.split('?');

      data.item = item;
      data.hash = hash;
      data.query = query;
    }
  }

  return data;
}

export function shorthandResolver(href: string, ctx: TiptapContext | undefined): ResolveResult {
  if (!href) return { href: '' };

  if (ctx) {
    if (href.startsWith('@')) {
      const { universe, item, hash, query } = extractLinkData(href);
      if (item) {;
        const universeLink = ctx.universeLink(universe ?? ctx.currentUniverse);
        return {
          href: `${universeLink}/items/${item}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`,
          exists: ctx.itemExists(universe ?? ctx.currentUniverse, item),
        };
      }
    }
  }

  return { href };
}

export const editorExtensions = (editMode: boolean, context?: TiptapContext, collabOptions?: { ydoc: Y.Doc, field?: string, provider: HocuspocusProvider }) => {
  const extensions: Extendable[] = [
    StarterKit.configure({
      link: false,
      heading: false,
      undoRedo: collabOptions ? false : undefined,
    }),
    Aside,
    Heading,
    Image,
    IFrame,
    Link.configure({
      enableClickSelection: editMode,
      openOnClick: !editMode,
      shorthandResolver,
      context,
    }),
    ToC.configure({ context }),
    TextAlign.configure({
      types: ['heading', 'paragraph'],
      defaultAlignment: 'left',
    }),
  ];

  if (editMode) {
    extensions.push(Mention.configure({
      items: () => context?.items?.() ?? {},
    }));
  }

  if (collabOptions) {
    const { ydoc, field, provider } = collabOptions;
    extensions.push(Collaboration.configure({
      document: ydoc,
      field,
    }));
    extensions.push(CollaborationCaret.configure({
      provider,
      selectionRender: (user) => {
        return {
          nodeName: 'span',
          class: 'collaboration-carets__selection',
          style: `background-color: ${user.color}70`,
          'data-user': user.name,
        }
      },
    }));
  }

  return extensions;
};
