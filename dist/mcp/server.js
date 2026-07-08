"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMcpServer = buildMcpServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const zod_1 = require("zod");
const api_1 = __importDefault(require("../api"));
const utils_1 = require("../api/utils");
const errors_1 = require("../errors");
const logger_1 = __importDefault(require("../logger"));
const gate = __importStar(require("./gating"));
function text(payload) {
    return { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }] };
}
function tool(fn) {
    return async (args) => {
        try {
            return await fn(args);
        }
        catch (err) {
            // RequestErrors (permission/gating/not-found) are routine denials; only log
            // unexpected failures at error level.
            if (err?.code === undefined)
                logger_1.default.error(err);
            const message = err?.message ?? 'An unexpected error occurred.';
            return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
        }
    };
}
async function requireExposedUniverse(user, shortname, capability) {
    const universe = await api_1.default.universe.getOne(user, { 'universe.shortname': shortname }, utils_1.perms.READ);
    const exposed = capability === 'items' ? gate.itemsExposed(universe)
        : capability === 'notes' ? gate.notesExposed(universe)
            : gate.discussionsExposed(universe);
    if (!exposed) {
        throw new errors_1.ForbiddenError(`MCP ${capability} access is not enabled for universe "${shortname}".`);
    }
    return universe;
}
function buildMcpServer(user) {
    const server = new mcp_js_1.McpServer({ name: 'archivium', version: '0.1.0' }, {
        instructions: 'Read-only access to the Archivium worldbuilding universes this user can see. ' +
            'Start with list_universes to discover which universes expose data, then use list_items / get_item ' +
            'to read worldbuilding entries. Notes and discussions are only available when the universe enables them.',
    });
    server.registerTool('list_universes', {
        title: 'List universes',
        description: 'List the worldbuilding universes the user can access that have MCP access enabled, and which data each exposes.',
    }, tool(async () => {
        const universes = await api_1.default.universe.getMany(user);
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
            universe_shortname: zod_1.z.string().describe('The shortname (slug) of the universe, from list_universes.'),
            type: zod_1.z.string().optional().describe('Filter by item type (e.g. "character", "location").'),
            tag: zod_1.z.string().optional().describe('Filter by tag.'),
            search: zod_1.z.string().optional().describe(`
        Free-text search over item titles, shortnames, body content, and tags. Matching is case-insensitive substring matching
        across all four fields in a single query, so a returned item doesn't by itself indicate which field(s) matched.
        If the query matches the item's body text (regardless of whether it also matches title, shortname, or tags),
        a "snippet" field is included containing a short window of text surrounding the match, to help clarify why the item matched.
        Results are not ranked by relevance.
      `),
            limit: zod_1.z.number().int().positive().max(200).optional().describe('Maximum number of items to return.'),
        },
    }, tool(async (args) => {
        await requireExposedUniverse(user, args.universe_shortname, 'items');
        const items = await api_1.default.item.getByUniverseShortname(user, args.universe_shortname, utils_1.perms.READ, {
            type: args.type,
            tag: args.tag,
            search: args.search,
            limit: args.limit,
        });
        return text(items.map((i) => ({
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
            universe_shortname: zod_1.z.string().describe('The shortname (slug) of the universe.'),
            item_shortname: zod_1.z.string().describe('The shortname (slug) of the item.'),
        },
    }, tool(async (args) => {
        await requireExposedUniverse(user, args.universe_shortname, 'items');
        const item = await api_1.default.item.getByUniverseAndItemShortnames(user, args.universe_shortname, args.item_shortname, utils_1.perms.READ, false, true);
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
            universe_shortname: zod_1.z.string().describe('The shortname (slug) of the universe.'),
            item_shortname: zod_1.z.string().describe('The shortname (slug) of the item.'),
        },
    }, tool(async (args) => {
        await requireExposedUniverse(user, args.universe_shortname, 'notes');
        const [notes] = await api_1.default.note.getByItemShortname(user, args.universe_shortname, args.item_shortname, { 'note.is_public': 1 });
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
            universe_shortname: zod_1.z.string().describe('The shortname (slug) of the universe.'),
        },
    }, tool(async (args) => {
        await requireExposedUniverse(user, args.universe_shortname, 'discussions');
        const threads = await api_1.default.discussion.getThreads(user, { 'universe.shortname': args.universe_shortname }, false, true);
        return text(threads.map((t) => ({
            id: t.id,
            title: t.title,
        })));
    }));
    server.registerTool('get_discussion', {
        title: 'Get discussion',
        description: 'Get a discussion thread and all its comments. Only available when the universe exposes discussions.',
        inputSchema: {
            universe_shortname: zod_1.z.string().describe('The shortname (slug) of the universe.'),
            thread_id: zod_1.z.number().int().describe('The id of the discussion thread, from list_discussions.'),
        },
    }, tool(async (args) => {
        await requireExposedUniverse(user, args.universe_shortname, 'discussions');
        // Confirm the thread belongs to this universe (and is accessible) before reading comments.
        const threads = await api_1.default.discussion.getThreads(user, { 'discussion.id': args.thread_id, 'universe.shortname': args.universe_shortname }, false, false);
        if (!threads.length)
            throw new errors_1.NotFoundError();
        const [comments] = await api_1.default.discussion.getCommentsByThread(user, args.thread_id, true);
        return text({
            id: threads[0].id,
            title: threads[0].title,
            comments: (comments ?? []).map((c) => ({ body: c.body, author_id: c.author_id, created_at: c.created_at, reply_to: c.reply_to })),
        });
    }));
    return server;
}
