"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoteAPI = void 0;
const crypto_1 = __importDefault(require("crypto"));
const errors_1 = require("../../errors");
const utils_1 = require("../utils");
class NoteAPI {
    api;
    constructor(api) {
        this.api = api;
    }
    async getOne(user, uuid) {
        // Direct note access is only allowed for our own notes.
        if (!user)
            throw new errors_1.UnauthorizedError();
        const notes = await this.getMany(user, { 'note.uuid': uuid }, { limit: 1, fullBody: true, connections: true });
        const note = notes[0];
        if (!note)
            throw new errors_1.NotFoundError();
        if (note.author_id !== user.id)
            throw new errors_1.ForbiddenError();
        return note;
    }
    /**
     * This should never be called on its own.
     * Users should have access to notes iff:
     * * they own the note,
     * * they have access to a board this note is pinned to, or,
     * * they have access to an item this note is linked to.
     * @param {*} user
     * @param {*} conditions
     * @param {*} options
     * @returns
     */
    async getMany(user, conditions, options) {
        const parsedConds = (0, utils_1.parseData)(conditions ?? {});
        if (user) {
            parsedConds.strings.push('(note.is_public OR note.author_id = ?)');
            parsedConds.values.push(user.id);
        }
        else {
            parsedConds.strings.push('note.is_public');
        }
        if (options?.search) {
            parsedConds.strings.push('(note.title LIKE ? OR note.body LIKE ? OR tag.tags LIKE ?)');
            parsedConds.values.push(`%${options?.search}%`);
            parsedConds.values.push(`%${options?.search}%`);
            parsedConds.values.push(`%${options?.search}%`);
            parsedConds.values.unshift(`%${options?.search}%`);
            parsedConds.values.unshift(`%${options?.search}%`);
        }
        const queryString = `
        SELECT DISTINCT
          note.id, note.uuid, note.title,
          note.is_public, note.author_id,
          note.created_at, note.updated_at,
          tag.tags,
          ${options?.fullBody ? 'note.body' : `SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(note.body, '$.text')), 1, 255) AS body`}
          ${options?.connections ? ', item.items' : ''}
          ${options?.connections ? ', board.boards' : ''}
          ${options?.search ? ', LOCATE(?, note.body) AS match_pos' : ''}
          ${options?.search ? ', SUBSTRING(note.body,  GREATEST(1, LOCATE(?, note.body) - 50), 100) AS snippet' : ''}
        FROM note
          ${options?.connections ? `LEFT JOIN (
            SELECT itemnote.note_id, JSON_ARRAYAGG(JSON_ARRAY(item.title, item.shortname, iu.title, iu.shortname)) as items
            FROM itemnote
            INNER JOIN item ON itemnote.item_id = item.id
            INNER JOIN universe AS iu ON iu.id = item.universe_id
            GROUP BY itemnote.note_id
          ) as item ON item.note_id = note.id` : ''}
          ${options?.connections ? `LEFT JOIN (
            SELECT boardnote.note_id, JSON_ARRAYAGG(JSON_ARRAY(noteboard.title, noteboard.shortname, nu.title, nu.shortname)) as boards
            FROM boardnote
            INNER JOIN noteboard ON boardnote.board_id = noteboard.id
            INNER JOIN universe AS nu ON nu.id = noteboard.universe_id
            GROUP BY boardnote.note_id
          ) as board ON board.note_id = note.id` : ''}
          LEFT JOIN itemnote ON itemnote.note_id = note.id
          LEFT JOIN boardnote ON boardnote.note_id = note.id
          LEFT JOIN (
            SELECT note_id, JSON_ARRAYAGG(tag) as tags
            FROM notetag
            GROUP BY note_id
          ) tag ON tag.note_id = note.id
          ${options?.join ?? ''}
        WHERE ${parsedConds.strings.join(' AND ')}
        ${options?.connections ? 'GROUP BY note.id' : ''}
        ${options?.limit ? `LIMIT ${options.limit}` : ''}
      `;
        const notes = await (0, utils_1.executeQuery)(queryString, parsedConds.values);
        if (options?.limit === 1 && options?.connections && notes[0]) {
            notes[0].items = (notes[0].items ?? []).filter(val => val[0] !== null);
            notes[0].boards = (notes[0].boards ?? []).filter(val => val[0] !== null);
        }
        return notes;
    }
    async getByUsername(sessionUser, username, conditions, options) {
        const user = await this.api.user.getOne({ 'user.username': username });
        if (!user)
            throw new errors_1.NotFoundError();
        const notes = await this.getMany(sessionUser, { ...(conditions ?? {}), 'note.author_id': user.id }, options ?? {});
        return notes;
    }
    async getByItemShortname(user, universeShortname, itemShortname, conditions, options, inclAuthors = false) {
        const item = await this.api.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.READ, true);
        const notes = await this.getMany(user, { ...conditions ?? {}, 'itemnote.item_id': item?.id }, { ...options ?? {} });
        if (inclAuthors) {
            const queryString2 = `
          SELECT user.id, user.username, user.email
          FROM user
          INNER JOIN note ON user.id = note.author_id
          INNER JOIN itemnote ON itemnote.note_id = note.id
          WHERE itemnote.item_id = ?
          GROUP BY user.id`;
            const users = await (0, utils_1.executeQuery)(queryString2, [item.id]);
            return [notes, users];
        }
        return [notes];
    }
    async getBoardsByUniverseShortname(user, shortname) {
        const universe = await this.api.universe.getOne(user, { 'universe.shortname': shortname }, utils_1.perms.READ);
        const boards = await (0, utils_1.executeQuery)('SELECT * FROM noteboard WHERE universe_id = ?', [universe.id]);
        return boards;
    }
    async getByBoardShortname(user, shortname, conditions = null, options = null, validate = true, inclAuthors = false) {
        const boards = await (0, utils_1.executeQuery)('SELECT * FROM noteboard WHERE shortname = ?', [shortname]);
        const board = boards[0];
        if (!board)
            throw new errors_1.NotFoundError();
        if (validate) {
            await this.api.universe.getOne(user, { 'universe.id': board.universe_id }, utils_1.perms.READ); // Make sure we have permission to see the universe
        }
        const notes = await this.getMany(user, { ...conditions ?? {}, 'boardnote.board_id': board.id }, { ...options ?? {} });
        if (inclAuthors) {
            const queryString2 = `
          SELECT user.id, user.username, user.email
          FROM user
          INNER JOIN note ON user.id = note.author_id
          INNER JOIN boardnote ON boardnote.note_id = note.id
          WHERE boardnote.board_id = ?
          GROUP BY user.id`;
            const users = await (0, utils_1.executeQuery)(queryString2, [board.id]);
            return [notes, users];
        }
        return notes;
    }
    async postBoard(user, { title, shortname }, universeShortname) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const universe = await this.api.universe.getOne(user, { 'universe.shortname': universeShortname }, utils_1.perms.WRITE);
        const queryString = `INSERT INTO noteboard (title, shortname, universe_id) VALUES (?, ?, ?);`;
        const data = await (0, utils_1.executeQuery)(queryString, [title, shortname, universe.id]);
        return data;
    }
    async post(user, { title, body, is_public, tags }) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const uuid = crypto_1.default.randomUUID();
        if (title === undefined || is_public === undefined)
            throw new errors_1.ValidationError('Missing required fields.');
        const queryString = `INSERT INTO note (uuid, title, body, is_public, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?);`;
        await (0, utils_1.executeQuery)(queryString, [uuid, title, body ? JSON.stringify(body) : null, is_public, user.id, new Date(), new Date()]);
        if (tags) {
            const trimmedTags = tags.map(tag => tag[0] === '#' ? tag.substring(1) : tag);
            this.putTags(user, uuid, trimmedTags);
        }
        return uuid;
    }
    async put(user, uuid, changes) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const { title, body, is_public, items, boards, tags } = changes;
        if (title === undefined || is_public === undefined)
            throw new errors_1.ValidationError();
        const note = await this.getOne(user, uuid);
        const queryString = `
        UPDATE note
        SET
          title = ?,
          body = ?,
          is_public = ?
        WHERE uuid = ?;
      `;
        const data = await (0, utils_1.executeQuery)(queryString, [title, body ? JSON.stringify(body) : null, is_public, note.uuid]);
        await (0, utils_1.executeQuery)('DELETE FROM itemnote WHERE note_id = ?', [note.id]);
        for (const [, item, , universe] of items ?? []) {
            await this.linkToItem(user, universe, item, uuid);
        }
        if (tags) {
            const trimmedTags = tags.map(tag => tag[0] === '#' ? tag.substring(1) : tag);
            // If tags list is provided, we can just as well handle it here
            await this.putTags(user, uuid, trimmedTags);
            const tagLookup = {};
            note.tags?.forEach(tag => {
                tagLookup[tag] = true;
            });
            trimmedTags.forEach(tag => {
                delete tagLookup[tag];
            });
            await this.delTags(user, uuid, Object.keys(tagLookup));
        }
        return data;
    }
    async linkToBoard(user, boardShortname, noteUuid) {
        if (!noteUuid)
            throw new errors_1.ValidationError('Note UUID is required');
        if (!user)
            throw new errors_1.UnauthorizedError();
        const board = (await (0, utils_1.executeQuery)('SELECT * FROM noteboard WHERE shortname = ?', [boardShortname]))[0];
        if (!board)
            throw new errors_1.NotFoundError();
        const note = await this.getOne(user, noteUuid);
        const queryString = `INSERT INTO boardnote (board_id, note_id) VALUES (?, ?)`;
        await (0, utils_1.executeQuery)(queryString, [board.id, note.id]);
    }
    async linkToItem(user, universeShortname, itemShortname, noteUuid) {
        if (!noteUuid)
            throw new errors_1.ValidationError('Note UUID is required');
        if (!user)
            throw new errors_1.UnauthorizedError();
        const item = await this.api.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.READ, true);
        const note = await this.getOne(user, noteUuid);
        const queryString = `INSERT INTO itemnote (item_id, note_id) VALUES (?, ?)`;
        await (0, utils_1.executeQuery)(queryString, [item.id, note.id]);
    }
    async putTags(user, uuid, tags) {
        if (tags.length === 0)
            return false;
        const note = await this.getOne(user, uuid);
        const tagLookup = {};
        note.tags?.forEach(tag => {
            tagLookup[tag] = true;
        });
        const filteredTags = tags.filter(tag => !tagLookup[tag]);
        const valueString = filteredTags.map(() => `(?, ?)`).join(',');
        const valueArray = filteredTags.reduce((arr, tag) => [...arr, note.id, tag], []);
        if (!valueString)
            return false;
        const queryString = `INSERT INTO notetag (note_id, tag) VALUES ${valueString};`;
        const data = await (0, utils_1.executeQuery)(queryString, valueArray);
        return true;
    }
    async delTags(user, uuid, tags) {
        if (tags.length === 0)
            return false;
        const note = await this.getOne(user, uuid);
        const whereString = tags.map(() => `tag = ?`).join(' OR ');
        if (!whereString)
            return false;
        const queryString = `DELETE FROM notetag WHERE note_id = ? AND (${whereString});`;
        const data = await (0, utils_1.executeQuery)(queryString, [note.id, ...tags]);
        return true;
    }
    async del(user, uuid) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const note = await this.getOne(user, uuid);
        // getOne will only return a note if we own it, but it doesn't hurt to double check for clarity
        if (note.author_id !== user.id)
            throw new errors_1.ForbiddenError();
        const data = await (0, utils_1.executeQuery)('DELETE FROM note WHERE uuid = ?', [uuid]);
        return data;
    }
}
exports.NoteAPI = NoteAPI;
