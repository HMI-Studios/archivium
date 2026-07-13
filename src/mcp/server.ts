import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import api from '../api';
import { perms } from '../api/utils';
import { User } from '../api/models/user';
import { BasicItem, Item } from '../api/models/item';
import { Universe } from '../api/models/universe';
import { ForbiddenError, NotFoundError } from '../errors';
import logger from '../logger';
import * as gate from './gating';

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

export function buildMcpServer(user: User): McpServer {
  const server = new McpServer(
    { name: 'archivium', version: '0.1.0' },
    {
      instructions:
        'Read-only access to the Archivium worldbuilding universes this user can see. ' +
        'Start with list_universes to discover which universes expose data, then use list_items / get_item ' +
        'to read worldbuilding entries. Notes and discussions are only available when the universe enables them.',
    },
  );

  server.registerTool('list_universes', {
    title: 'List universes',
    description: 'List the worldbuilding universes the user can access that have MCP access enabled, and which data each exposes.',
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
    },
  }, tool(async (args: { universe_shortname: string, item_shortname: string }) => {
    await requireExposedUniverse(user, args.universe_shortname, 'items');
    const item = await api.item.getByUniverseAndItemShortnames(
      user, args.universe_shortname, args.item_shortname, perms.READ, false, true,
    ) as Item;
    const objData = (typeof item.obj_data === 'string' ? JSON.parse(item.obj_data) : item.obj_data) ?? {};
    return text({
      shortname: item.shortname,
      title: item.title,
      item_type: item.item_type,
      tags: item.tags,
      author: item.author,
      body: objData?.body?.text ?? '',
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
  }, tool(async (args: { universe_shortname: string, item_shortname: string }) => {
    await requireExposedUniverse(user, args.universe_shortname, 'notes');
    const [notes] = await api.note.getByItemShortname(
      user, args.universe_shortname, args.item_shortname, { 'note.is_public': 1 },
    );
    return text((notes ?? []).filter((n) => n.is_public).map((n) => ({
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

  return server;
}
