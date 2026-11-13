import { generateJSON } from '@tiptap/html/server';
import { renderToHTMLString } from '@tiptap/static-renderer/pm/html-string';
import { editorExtensions } from '../lib/editor';
import { IndexedDocument, JsonNode, indexedToJson, jsonToIndexed } from '../lib/tiptapHelpers';

function isIndexed(doc: unknown): doc is IndexedDocument {
  return !!doc && typeof doc === 'object' && 'structure' in doc && 'text' in doc;
}

function htmlToJson(html: string): JsonNode {
  return generateJSON(html, editorExtensions(false)) as JsonNode;
}

export function htmlToIndexed(html: string): IndexedDocument {
  return jsonToIndexed(htmlToJson(html));
}

export function appendHtml(doc: unknown, html: string): IndexedDocument {
  const existing = isIndexed(doc) ? indexedToJson(doc) : { type: 'doc', content: [] };
  const added = htmlToJson(html);
  return jsonToIndexed({
    type: 'doc',
    content: [...(existing.content as JsonNode[] ?? []), ...(added.content ?? [])],
  });
}

export function bodyToHtml(doc: unknown): string {
  if (typeof doc === 'string') return doc; // Legacy markdown bodies.
  if (!isIndexed(doc)) return '';
  return renderToHTMLString({ extensions: editorExtensions(false), content: indexedToJson(doc) });
}

export function bodyToText(doc: unknown): string {
  if (typeof doc === 'string') return doc;
  return isIndexed(doc) ? doc.text : '';
}
