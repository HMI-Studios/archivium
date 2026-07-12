import { renderToHTMLString } from '@tiptap/static-renderer/pm/html-string';
import { Request } from 'express';
import sanitizeHtml from 'sanitize-html';
import api from '../api';
import { universeLink } from '../templates';
import { LinkData, TiptapContext, editorExtensions, extractLinkData } from './editor';
import { IndexedDocument, indexedToJson } from './tiptapHelpers';
import logger from '../logger';


export type RenderedBody = { type: string, content: any };
export async function tryRenderContent(req: Request, content: unknown, universeShortname: string | null): Promise<RenderedBody> {
  try {
    const links: LinkData[] = [];
    const headings: { title: string, level: number }[] = [];
    const jsonBody = indexedToJson(
      content as IndexedDocument,
      (href) => links.push(extractLinkData(href)),
      (title, level) => headings.push({ title, level }),
    );
    const itemsPerUniverse = {};
    /* Because Tiptap rendering cannot be async, we extract the links we'll need to check ahead of time. */
    await Promise.all(links.map(async (link) => {
      if (link.item) {
        const universeShort = link.universe ?? universeShortname;
        if (!universeShort) return;
        if (!(universeShort in itemsPerUniverse)) {
          itemsPerUniverse[universeShort] = {};
        }
        if (!(link.item in itemsPerUniverse[universeShort])) {
          itemsPerUniverse[universeShort][link.item] = await api.item.exists(req.session.user, universeShort, link.item);
        }
      }
    }));
    const renderContext: TiptapContext = {
      currentUniverse: universeShortname,
      universeLink: (universeShort) => universeLink(req, universeShort),
      itemExists: (universe, item) => (universe in itemsPerUniverse) && itemsPerUniverse[universe][item],
      headings,
    };
    const htmlBody = renderToHTMLString({ extensions: editorExtensions(false, renderContext), content: jsonBody });
    const sanitizedHtml = sanitizeHtml(htmlBody, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'iframe']),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        img: ['src', 'alt', 'title', 'width', 'height'],
        iframe: ['src'],
        h1: ['id', 'style'], h2: ['id', 'style'], h3: ['id', 'style'],
        h4: ['id', 'style'], h5: ['id', 'style'], h6: ['id', 'style'],
        p: ['style'],
      },
      disallowedTagsMode: 'escape',
      allowedClasses: {
        '*': false,
      },
    });
    return {
      type: 'html',
      content: sanitizedHtml,
    };
  } catch (err) {
    logger.error('Failed to parse content:');
    logger.error(err);
    return { type: 'text', content };
  }
}
