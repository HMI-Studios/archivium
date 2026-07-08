"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const api_1 = __importDefault(require("../../api"));
const utils_1 = require("../../api/utils");
const embedding_1 = __importDefault(require("../../embedding"));
const errors_1 = require("../../errors");
const logger_1 = __importDefault(require("../../logger"));
const staticDir = path_1.default.join(__dirname, '../../static');
/**
 * Finds the current content-hashed filename for a lazy-loaded editor chunk
 * (e.g. 'item-edit' -> 'item-edit.<hash>.chunk.js'), so the page can preload
 * it instead of waiting for the bundle to run and discover it needs it.
 */
async function findEditorChunk(prefix) {
    const files = await promises_1.default.readdir(path_1.default.join(staticDir, 'editor')).catch(() => []);
    return files.find((file) => new RegExp(`^${prefix}\\.[a-f0-9]+\\.chunk\\.js$`).test(file)) ?? null;
}
exports.default = {
    /* Terms and Agreements */
    async privacyPolicy(_, res) {
        const content = (await promises_1.default.readFile(path_1.default.join(staticDir, 'privacy_policy.md'))).toString();
        res.prepareRender('docs', { content });
    },
    async termsOfService(_, res) {
        const content = (await promises_1.default.readFile(path_1.default.join(staticDir, 'ToS.md'))).toString();
        res.prepareRender('docs', { content });
    },
    async codeOfConduct(_, res) {
        const content = (await promises_1.default.readFile(path_1.default.join(staticDir, 'code_of_conduct.md'))).toString();
        res.prepareRender('docs', { content });
    },
    /* Home Page */
    async home(req, res) {
        const user = req.session.user;
        if (user) {
            const universes = await api_1.default.universe.getMany(user, null, utils_1.perms.WRITE);
            const followedUniverses = await api_1.default.universe.getMany(user, {
                strings: ['fu.user_id = ?', 'fu.is_following = ?'],
                values: [user.id, true],
            }, utils_1.perms.READ);
            const followedUniverseIds = `(${followedUniverses.map(universe => universe.id).join(',')})`;
            const recentlyUpdated = followedUniverses.length > 0 ? await api_1.default.item.getMany(user, null, utils_1.perms.READ, {
                sort: 'updated_at',
                sortDesc: true,
                limit: 8,
                select: [['lub.username', 'last_updated_by']],
                join: [['LEFT', ['user', 'lub'], new utils_1.Cond('lub.id = item.last_updated_by')]],
                where: new utils_1.Cond(`item.universe_id IN ${followedUniverseIds}`)
                    .and(new utils_1.Cond('lub.id <> ?', user.id).or(new utils_1.Cond('item.last_updated_by IS NULL').and('item.author_id <> ?', user.id))),
            }) : [200, []];
            const oldestUpdated = await api_1.default.item.getMany(user, null, utils_1.perms.WRITE, {
                sort: `GREATEST(IFNULL(snooze.snoozed_at, '1000-01-01'), IFNULL(item.updated_at, '1000-01-01'))`,
                sortDesc: false,
                forceSort: true,
                limit: 16,
                join: [['LEFT', 'snooze', new utils_1.Cond('snooze.item_id = item.id').and('snooze.snoozed_by = ?', user.id)]],
                where: new utils_1.Cond('item.updated_at < DATE_SUB(NOW(), INTERVAL 2 DAY)'),
                groupBy: ['snooze.snoozed_at'],
            });
            return res.prepareRender('home', { universes, followedUniverses, recentlyUpdated, oldestUpdated });
        }
        res.prepareRender('home', { universes: [] });
    },
    /* Note pages */
    async notes(req, res) {
        const user = req.session.user;
        if (!user)
            throw new errors_1.UnauthorizedError();
        const notes = await api_1.default.note.getByUsername(user, user.username, {}, { connections: true });
        const noteAuthors = { [user.id]: user };
        res.prepareRender('notes', {
            notes,
            noteAuthors,
            noteBaseRoute: `/api/users/${user.username}/notes`,
        });
    },
    /* Misc pages */
    async search(req, res) {
        const search = req.getQueryParam('search');
        if (search) {
            const universes = await api_1.default.universe.getMany(req.session.user, { strings: ['title LIKE ?'], values: [`%${search}%`] });
            const items = await api_1.default.item.getMany(req.session.user, null, utils_1.perms.READ, { search });
            const notes = req.session.user ? await api_1.default.note.getByUsername(req.session.user, req.session.user.username, null, { search }) : [];
            let semanticItems = [];
            try {
                const alreadyMatched = new Set(items.map(item => item.id));
                const results = await embedding_1.default.search(req.session.user, { query: search });
                semanticItems = results
                    .filter(({ item }) => !alreadyMatched.has(item.id))
                    .map(({ item, chunks }) => ({
                    ...item,
                    snippet: chunks.sort((a, b) => a.score > b.score ? -1 : 1)[0]?.content.substring(0, 100),
                    semantic: true,
                }));
            }
            catch (err) {
                logger_1.default.error(`Semantic search failed during page search: ${err}`);
            }
            res.prepareRender('search', { items: [...items, ...semanticItems], universes, notes, search });
        }
        else {
            res.prepareRender('search', { items: [], universes: [], notes: [], search: '' });
        }
    },
    /* React Editor */
    async editor(req, res) {
        const params = req.params[0]?.split('/') ?? [];
        const data = {};
        if (params[0] === 'universes' && params[1]) {
            const [, universeShort] = params;
            data.universe = await api_1.default.universe.getOne(req.session.user, { shortname: universeShort });
        }
        if (params[0] === 'universes' && params[2] === 'items' && params[3]) {
            data.preloadChunk = await findEditorChunk('item-edit');
        }
        else if (params[0] === 'stories' && params[2]) {
            data.preloadChunk = await findEditorChunk('chapter-edit');
        }
        res.prepareRender('editor', data);
    }
};
