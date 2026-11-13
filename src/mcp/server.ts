import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import api from '../api';
import { perms } from '../api/utils';
import { User } from '../api/models/user';
import { BasicItem, Item, ObjData } from '../api/models/item';
import { Universe } from '../api/models/universe';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import logger from '../logger';
import { addDefaultTabs } from '../lib/itemTypeConfig';
import * as gate from './gating';
import { Grant } from '../api/models/oauth';
import { GrantCheck, grantAllows, grantHasAnyWrite } from './grants';
import { appendHtml, bodyToHtml, bodyToText, htmlToIndexed } from './content';

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

type ToolResult = { content: { type: 'text', text: string }[], isError?: boolean };

function text(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }] };
}

function tool<A>(fn: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      // RequestErrors (permission/gating/not-found) are routine denials; only log
      // unexpected failures at error level.
      if (err?.code === undefined) logger.error(err);
      const message = err?.message ?? 'An unexpected error occurred.';
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  };
}

async function requireExposedUniverse(
  user: User,
  shortname: string,
  capability: 'items' | 'notes' | 'discussions',
): Promise<Universe> {
  const universe = await api.universe.getOne(user, { 'universe.shortname': shortname }, perms.READ);
  const exposed =
    capability === 'items' ? gate.itemsExposed(universe)
    : capability === 'notes' ? gate.notesExposed(universe)
    : gate.discussionsExposed(universe);
  if (!exposed) {
    throw new ForbiddenError(`MCP ${capability} access is not enabled for universe "${shortname}".`);
  }
  return universe;
}

async function requireWritableUniverse(
  user: User,
  grant: Grant,
  shortname: string,
  capability: GrantCheck,
): Promise<Universe> {
  const universe = await api.universe.getOne(user, { 'universe.shortname': shortname }, perms.READ);
  const writable = capability === 'items' ? gate.itemsWritable(universe) : gate.notesWritable(universe);
  if (!writable) {
    throw new ForbiddenError(`MCP ${capability} editing is not enabled for universe "${shortname}".`);
  }
  if (!grantAllows(grant, universe.id, capability)) {
    throw new ForbiddenError(
      `The user has not granted this application permission to edit ${capability} in universe "${shortname}". ` +
      'They can change this in their Archivium settings under "Connected Apps".',
    );
  }
  return universe;
}

function parseObjData(objData: unknown): ObjData {
  return ((typeof objData === 'string' ? JSON.parse(objData) : objData) ?? {}) as ObjData;
}

export function buildMcpServer(user: User, grant: Grant): McpServer {
  const canWrite = grantHasAnyWrite(grant);
  const server = new McpServer(
    { name: 'archivium', version: '0.2.0' },
    {
      instructions:
        (canWrite
          ? 'Access to the Archivium worldbuilding universes this user can see, including editing in universes where the user allowed it. '
          : 'Read-only access to the Archivium worldbuilding universes this user can see. ') +
        'Start with list_universes to discover which universes expose data (and which you may edit), then use list_items / get_item ' +
        'to read worldbuilding entries. Notes and discussions are only available when the universe enables them.' +
        (canWrite
          ? ' Rich text is exchanged as HTML: call get_item with format "html" before editing a body, and preserve elements you do not intend to change. ' +
            'Link to other items with <a href="@item-shortname">, or <a href="@universe-shortname/item-shortname"> across universes.'
          : ''),
    },
  );

  const logWrite = (toolName: string, details: Record<string, unknown>) => {
    logger.info(`MCP write - user: ${user.id}, client: ${grant.client_id}, tool: ${toolName}, ${JSON.stringify(details)}`);
  };

  server.registerTool('list_universes', {
    title: 'List universes',
    description: 'List the worldbuilding universes the user can access that have MCP access enabled, which data each exposes, which data you may edit, and the item types each universe defines.',
    annotations: READ_ONLY,
  }, tool(async () => {
    const universes = await api.universe.getMany(user);
    const visible = universes.filter(gate.mcpVisible).map((u) => ({
      shortname: u.shortname,
      title: u.title,
      is_public: Boolean(u.is_public),
      exposes: {
        items: gate.itemsExposed(u),
        notes: gate.notesExposed(u),
        discussions: gate.discussionsExposed(u),
      },
      writable: {
        items: gate.itemsWritable(u) && grantAllows(grant, u.id, 'items') && (u.author_permissions?.[user.id] ?? perms.NONE) >= perms.WRITE,
        notes: gate.notesWritable(u) && grantAllows(grant, u.id, 'notes'),
      },
      item_types: Object.fromEntries(Object.entries(u.obj_data?.cats ?? {}).map(([type, [title]]) => [type, title])),
    }));
    return text(visible);
  }));

  server.registerTool('list_items', {
    title: 'List items',
    description: 'List worldbuilding items in a universe. Optionally filter by type, tag, or a text search.',
    inputSchema: {
      universe_shortname: z.string().describe('The shortname (slug) of the universe, from list_universes.'),
      type: z.string().optional().describe('Filter by item type (e.g. "character", "location").'),
      tag: z.string().optional().describe('Filter by tag.'),
      search: z.string().optional().describe(`
        Free-text search over item titles, shortnames, body content, and tags. Matching is case-insensitive substring matching
        across all four fields in a single query, so a returned item doesn't by itself indicate which field(s) matched.
        If the query matches the item's body text (regardless of whether it also matches title, shortname, or tags),
        a "snippet" field is included containing a short window of text surrounding the match, to help clarify why the item matched.
        Results are not ranked by relevance.
      `),
      limit: z.number().int().positive().max(200).optional().describe('Maximum number of items to return.'),
    },
    annotations: READ_ONLY,
  }, tool(async (args: { universe_shortname: string, type?: string, tag?: string, search?: string, limit?: number }) => {
    await requireExposedUniverse(user, args.universe_shortname, 'items');
    const items = await api.item.getByUniverseShortname(user, args.universe_shortname, perms.READ, {
      type: args.type,
      tag: args.tag,
      search: args.search,
      limit: args.limit,
    });
    return text(items.map((i: BasicItem & { snippet?: string }) => ({
      shortname: i.shortname,
      title: i.title,
      item_type: i.item_type,
      tags: i.tags,
      author: i.author,
      updated_at: i.updated_at,
      snippet: i.snippet,
    })));
  }));

  server.registerTool('get_item', {
    title: 'Get item',
    description: 'Get the full content of a single worldbuilding item, including its body text, custom fields, lineage (parents/children) and timeline events.',
    inputSchema: {
      universe_shortname: z.string().describe('The shortname (slug) of the universe.'),
      item_shortname: z.string().describe('The shortname (slug) of the item.'),
      format: z.enum(['text', 'html']).optional().describe(
        'Format of the body: "text" (default) is plain text; "html" preserves formatting, links and images and should be used before editing the body.',
      ),
    },
    annotations: READ_ONLY,
  }, tool(async (args: { universe_shortname: string, item_shortname: string, format?: 'text' | 'html' }) => {
    await requireExposedUniverse(user, args.universe_shortname, 'items');
    const item = await api.item.getByUniverseAndItemShortnames(
      user, args.universe_shortname, args.item_shortname, perms.READ, false, true,
    ) as Item;
    const objData = parseObjData(item.obj_data);
    return text({
      shortname: item.shortname,
      title: item.title,
      item_type: item.item_type,
      tags: item.tags,
      author: item.author,
      body: args.format === 'html' ? bodyToHtml(objData.body) : bodyToText(objData.body),
      fields: objData?.tabs ?? undefined,
      parents: item.parents,
      children: item.children,
      events: item.events,
    });
  }));

  server.registerTool('list_item_notes', {
    title: 'List item notes',
    description: 'List the public notes attached to a specific item. Only available when the universe exposes notes.',
    inputSchema: {
      universe_shortname: z.string().describe('The shortname (slug) of the universe.'),
      item_shortname: z.string().describe('The shortname (slug) of the item.'),
    },
    annotations: READ_ONLY,
  }, tool(async (args: { universe_shortname: string, item_shortname: string }) => {
    await requireExposedUniverse(user, args.universe_shortname, 'notes');
    const [notes] = await api.note.getByItemShortname(
      user, args.universe_shortname, args.item_shortname, { 'note.is_public': 1 },
    );
    return text((notes ?? []).filter((n) => n.is_public).map((n) => ({
      uuid: n.uuid,
      is_mine: n.author_id === user.id,
      title: n.title,
      body: n.body,
      updated_at: n.updated_at,
    })));
  }));

  server.registerTool('list_discussions', {
    title: 'List discussions',
    description: 'List discussion threads in a universe. Only available when the universe exposes discussions.',
    inputSchema: {
      universe_shortname: z.string().describe('The shortname (slug) of the universe.'),
    },
    annotations: READ_ONLY,
  }, tool(async (args: { universe_shortname: string }) => {
    await requireExposedUniverse(user, args.universe_shortname, 'discussions');
    const threads = await api.discussion.getThreads(user, { 'universe.shortname': args.universe_shortname }, false, true);
    return text(threads.map((t) => ({
      id: t.id,
      title: t.title,
    })));
  }));

  server.registerTool('get_discussion', {
    title: 'Get discussion',
    description: 'Get a discussion thread and all its comments. Only available when the universe exposes discussions.',
    inputSchema: {
      universe_shortname: z.string().describe('The shortname (slug) of the universe.'),
      thread_id: z.number().int().describe('The id of the discussion thread, from list_discussions.'),
    },
    annotations: READ_ONLY,
  }, tool(async (args: { universe_shortname: string, thread_id: number }) => {
    await requireExposedUniverse(user, args.universe_shortname, 'discussions');
    // Confirm the thread belongs to this universe (and is accessible) before reading comments.
    const threads = await api.discussion.getThreads(
      user, { 'discussion.id': args.thread_id, 'universe.shortname': args.universe_shortname }, false, false,
    );
    if (!threads.length) throw new NotFoundError();
    const [comments] = await api.discussion.getCommentsByThread(user, args.thread_id, true);
    return text({
      id: threads[0].id,
      title: threads[0].title,
      comments: (comments ?? []).map((c) => ({ body: c.body, author_id: c.author_id, created_at: c.created_at, reply_to: c.reply_to })),
    });
  }));

  if (canWrite) registerWriteTools(server, user, grant, logWrite);

  return server;
}

const HTML_BODY_HELP =
  'HTML body. Supported: p, h1-h6, strong, em, s, code, a, ul/ol/li, blockquote, pre, hr, table, aside, and images as ' +
  '<div class="img-container"><img src="..."></div>. Link to items with <a href="@item-shortname"> ' +
  '(or "@universe-shortname/item-shortname" for another universe). Unsupported elements are dropped.';

function registerWriteTools(
  server: McpServer,
  user: User,
  grant: Grant,
  logWrite: (toolName: string, details: Record<string, unknown>) => void,
): void {
  server.registerTool('create_item', {
    title: 'Create item',
    description: 'Create a new worldbuilding item in a universe. Only available in universes where list_universes reports writable.items.',
    inputSchema: {
      universe_shortname: z.string().describe('The shortname (slug) of the universe.'),
      title: z.string().min(1).max(64).describe('The item title.'),
      shortname: z.string().min(1).max(64).describe('URL slug for the item: lowercase letters, numbers and hyphens. Must be unique within the universe.'),
      item_type: z.string().describe('The item type; must be one of the universe\'s item_types from list_universes.'),
      body_html: z.string().optional().describe(HTML_BODY_HELP),
      tags: z.array(z.string()).optional().describe('Tags for the item, without the leading "#".'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, tool(async (args: { universe_shortname: string, title: string, shortname: string, item_type: string, body_html?: string, tags?: string[] }) => {
    const universe = await requireWritableUniverse(user, grant, args.universe_shortname, 'items');
    const types = Object.keys(universe.obj_data?.cats ?? {});
    if (types.length > 0 && !types.includes(args.item_type)) {
      throw new ValidationError(`Unknown item type "${args.item_type}". Valid types: ${types.join(', ')}.`);
    }

    const objData = addDefaultTabs(
      args.body_html !== undefined ? { body: htmlToIndexed(args.body_html) } : {},
      universe.obj_data,
      args.item_type,
    );
    await api.item.post(user, {
      title: args.title,
      shortname: args.shortname,
      item_type: args.item_type,
      obj_data: objData,
    }, universe.shortname);
    if (args.tags?.length || args.body_html !== undefined) {
      await api.item.put(user, universe.shortname, args.shortname, { title: args.title, obj_data: objData, tags: args.tags });
    }

    logWrite('create_item', { universe: universe.shortname, item: args.shortname });
    return text({ created: true, universe_shortname: universe.shortname, item_shortname: args.shortname });
  }));

  server.registerTool('update_item', {
    title: 'Update item',
    description:
      'Update an existing item\'s title, tags or body. Only the fields you pass are changed. ' +
      'To change the body, either replace it entirely with body_html (fetch it first with get_item format "html" and preserve what you are not changing), ' +
      'or add to the end of it with append_html.',
    inputSchema: {
      universe_shortname: z.string().describe('The shortname (slug) of the universe.'),
      item_shortname: z.string().describe('The shortname (slug) of the item.'),
      title: z.string().min(1).max(64).optional().describe('New title.'),
      tags: z.array(z.string()).optional().describe('Replaces the full tag list. Omit to leave tags unchanged.'),
      body_html: z.string().optional().describe(`Replaces the whole body. ${HTML_BODY_HELP}`),
      append_html: z.string().optional().describe('HTML appended to the end of the existing body. Cannot be combined with body_html.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, tool(async (args: { universe_shortname: string, item_shortname: string, title?: string, tags?: string[], body_html?: string, append_html?: string }) => {
    if (args.body_html !== undefined && args.append_html !== undefined) {
      throw new ValidationError('Pass either body_html or append_html, not both.');
    }
    await requireWritableUniverse(user, grant, args.universe_shortname, 'items');
    const item = await api.item.getByUniverseAndItemShortnames(
      user, args.universe_shortname, args.item_shortname, perms.WRITE, false, true,
    ) as Item;

    const objData = parseObjData(item.obj_data);
    if (args.body_html !== undefined) objData.body = htmlToIndexed(args.body_html);
    else if (args.append_html !== undefined) objData.body = appendHtml(objData.body, args.append_html);

    await api.item.put(user, args.universe_shortname, args.item_shortname, {
      title: args.title ?? item.title,
      obj_data: objData,
      tags: args.tags,
    });

    logWrite('update_item', {
      universe: args.universe_shortname,
      item: args.item_shortname,
      fields: ['title', 'tags', 'body_html', 'append_html'].filter((k) => args[k] !== undefined),
    });
    return text({ updated: true, universe_shortname: args.universe_shortname, item_shortname: args.item_shortname });
  }));

  server.registerTool('create_item_note', {
    title: 'Create item note',
    description: 'Create a note owned by the user and attach it to an item. Only available in universes where list_universes reports writable.notes.',
    inputSchema: {
      universe_shortname: z.string().describe('The shortname (slug) of the universe.'),
      item_shortname: z.string().describe('The shortname (slug) of the item to attach the note to.'),
      title: z.string().max(64).describe('The note title.'),
      body_html: z.string().describe(HTML_BODY_HELP),
      is_public: z.boolean().describe('Whether other users who can see the item can see this note. Only public notes are visible through list_item_notes.'),
      tags: z.array(z.string()).optional().describe('Tags for the note, without the leading "#".'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, tool(async (args: { universe_shortname: string, item_shortname: string, title: string, body_html: string, is_public: boolean, tags?: string[] }) => {
    await requireWritableUniverse(user, grant, args.universe_shortname, 'notes');
    await api.item.getByUniverseAndItemShortnames(user, args.universe_shortname, args.item_shortname, perms.READ, true);

    const uuid = await api.note.post(user, {
      title: args.title,
      body: htmlToIndexed(args.body_html),
      is_public: args.is_public,
      tags: args.tags,
    });
    await api.note.linkToItem(user, args.universe_shortname, args.item_shortname, uuid);

    logWrite('create_item_note', { universe: args.universe_shortname, item: args.item_shortname, note: uuid });
    return text({ created: true, uuid });
  }));

  server.registerTool('update_item_note', {
    title: 'Update item note',
    description: 'Update a note the user owns that is attached to the given item. Only the fields you pass are changed.',
    inputSchema: {
      universe_shortname: z.string().describe('The shortname (slug) of the universe.'),
      item_shortname: z.string().describe('The shortname (slug) of the item the note is attached to.'),
      note_uuid: z.string().describe('The uuid of the note, from list_item_notes or create_item_note.'),
      title: z.string().max(64).optional().describe('New title.'),
      body_html: z.string().optional().describe(`Replaces the whole note body. ${HTML_BODY_HELP}`),
      is_public: z.boolean().optional().describe('New visibility.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, tool(async (args: { universe_shortname: string, item_shortname: string, note_uuid: string, title?: string, body_html?: string, is_public?: boolean }) => {
    await requireWritableUniverse(user, grant, args.universe_shortname, 'notes');
    const note = await api.note.getOne(user, args.note_uuid);
    const attached = (note.items ?? []).some(([, itemShort, , universeShort]) => (
      itemShort === args.item_shortname && universeShort === args.universe_shortname
    ));
    if (!attached) throw new NotFoundError('Note is not attached to this item.');

    await api.note.put(user, note.uuid, {
      title: args.title ?? note.title,
      body: args.body_html !== undefined ? htmlToIndexed(args.body_html) : note.body,
      is_public: args.is_public ?? Boolean(note.is_public),
      items: note.items,
    });

    logWrite('update_item_note', {
      universe: args.universe_shortname,
      item: args.item_shortname,
      note: note.uuid,
      fields: ['title', 'body_html', 'is_public'].filter((k) => args[k] !== undefined),
    });
    return text({ updated: true, uuid: note.uuid });
  }));
}
