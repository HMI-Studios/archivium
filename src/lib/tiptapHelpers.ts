interface OffsetTextNode {
  type: string;
  start?: number;
  end?: number;
  marks?: any[];
  content?: OffsetTextNode[];
  attrs?: { [key: string]: any };
}

interface CombinedNode {
  type: string;
  text?: string;
  marks?: any[];
  content?: OffsetTextNode[];
  attrs?: { [key: string]: any };
}

export interface IndexedDocument {
  text: string;
  structure: OffsetTextNode[];
}

function cleanupMark(mark) {
  const newMark = { ...mark };
  if (newMark.type === 'link') {
    newMark.attrs = {
      href: newMark.attrs.href,
      class: newMark.attrs.class,
    };
  }
  return newMark;
}

export function jsonToIndexed(doc: any): IndexedDocument {
  let textBuffer = '';
  let pos = 0;

  function walk(node: any): OffsetTextNode {
    if (node.type === 'text') {
      const start = pos;
      textBuffer += node.text || '';
      pos += (node.text || '').length;
      return {
        type: 'text',
        start,
        end: pos,
        marks: (node.marks || []).map(cleanupMark),
        attrs: node.attrs ?? {},
      };
    }

    const content = (node.content || []).map(walk);

    // preserve block breaks between top-level nodes
    if ((node.type === 'paragraph' || node.type === 'heading') && content.length > 0) {
      textBuffer += '\n';
      pos += 1;
    }

    return {
      type: node.type,
      marks: (node.marks || []).map(cleanupMark),
      attrs: node.attrs ?? {},
      content,
    };
  }

  const structure = (doc.content || []).map(walk);
  return { text: textBuffer, structure };
}

export function getTextContent(node: CombinedNode) {
  return `${node.text ?? ''}${(node.content ?? []).map(getTextContent).join('')}`;
}

/**
 * Mutates the provided IndexedDocument.
 */
export function updateLinks(indexed: IndexedDocument, getNewLink: (href: string) => string): void {
  const { structure } = indexed;

  function walk(node: OffsetTextNode): void {
    if (node.type === 'text') {
      for (const mark of node.marks ?? []) {
        if (mark.attrs && mark.attrs.href && mark.attrs.href.startsWith('@')) {
          mark.attrs.href = getNewLink(mark.attrs.href);
        }
      }
    }
    if (node.content && node.content.length > 0) {
      node.content.forEach(walk);
    }
  }

  structure.forEach(walk)
}

export function indexedToJson(indexed: IndexedDocument, linkHandler?: (href: string) => void, headingHandler?: (text: string, level: number) => void): any {
  const { text, structure } = indexed;

  function walk(node: OffsetTextNode): any {
    if (node.type === 'text') {
      const combinedNode: CombinedNode = {
        type: 'text',
        text: text.slice(node.start, node.end),
      };
      if (node.marks && node.marks.length > 0) combinedNode.marks = node.marks;
      if (node.attrs && Object.keys(node.attrs).length > 0) combinedNode.attrs = node.attrs;
      for (const mark of combinedNode.marks ?? []) {
        if (mark.attrs && mark.attrs.href && linkHandler) {
          linkHandler(mark.attrs.href);
        }
      }
      return combinedNode;
    }

    const combinedNode: CombinedNode = { type: node.type };
    if (node.marks && node.marks.length > 0) combinedNode.marks = node.marks;
    if (node.attrs && Object.keys(node.attrs).length > 0) combinedNode.attrs = node.attrs;
    if (node.content && node.content.length > 0) {
      combinedNode.content = node.content.map(walk);
    }

    if (node.type === 'heading' && headingHandler) {
      const text = getTextContent(combinedNode);
      if (text) headingHandler(text, combinedNode.attrs?.level ?? 1);
    }

    return combinedNode;
  }

  return { type: 'doc', content: structure.map(walk) };
}

type Heading = { title: string, level: number };
type TocSection = { level: number, headings: Heading[], tocNodes: CombinedNode[] };

export function annotateTocScopes(doc: CombinedNode): void {
  const stack: TocSection[] = [];

  function closeSectionsAtOrAbove(level: number) {
    while (stack.length && stack[stack.length - 1].level >= level) {
      const section = stack.pop()!;
      for (const tocNode of section.tocNodes) {
        tocNode.attrs = { ...tocNode.attrs, scopedHeadings: section.headings };
      }
    }
  }

  function walk(node: CombinedNode) {
    if (node.type === 'heading') {
      const level = node.attrs?.level ?? 1;
      const title = getTextContent(node);
      closeSectionsAtOrAbove(level);
      if (title) {
        for (const section of stack) section.headings.push({ title, level });
      }
      stack.push({ level, headings: [], tocNodes: [] });
    } else if (node.type === 'toc' && stack.length > 0) {
      stack[stack.length - 1].tocNodes.push(node);
    }

    (node.content ?? []).forEach(walk);
  }

  walk(doc);
  closeSectionsAtOrAbove(-Infinity);
}
