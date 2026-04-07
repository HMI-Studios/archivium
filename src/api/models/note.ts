import crypto from 'crypto';
import { ResultSetHeader } from "mysql2";
import { API } from "..";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "../../errors";
import { IndexedDocument } from "../../lib/tiptapHelpers";
import { BaseOptions, executeQuery, parseData, perms } from '../utils';
import { User } from "./user";

export type NoteItemTuple = [string, string, string, string];
export type NoteBoardTuple = [string, string, string, string];

type NoteOptions = BaseOptions & {
  fullBody?: boolean,
  connections?: boolean,
};

type NoteBoard = {
  id: number,
  title: string,
  shortname: string,
  is_public: boolean,
  universe_id: number,
};

export type Note = {
  id: number,
  uuid: string,
  title: string,
  body: IndexedDocument,
  is_public: boolean
  author_id: number,
  created_at: Date,
  updated_at: Date,
  items?: NoteItemTuple[],
  boards?: NoteBoardTuple[],
  tags?: string[],
};

export class NoteAPI {
  readonly api: API;

  constructor(api: API) {
    this.api = api;
  }

  async getOne(user: User | undefined, uuid: string): Promise<Note> {
    // Direct note access is only allowed for our own notes.
    if (!user) throw new UnauthorizedError();

    const notes = await this.getMany(user, { 'note.uuid': uuid }, { limit: 1, fullBody: true, connections: true });
    const note = notes[0];
    if (!note) throw new NotFoundError();
    if (note.author_id !== user.id) throw new ForbiddenError();
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
  async getMany(user: User | undefined, conditions, options): Promise<Note[]> {
    const parsedConds = parseData(conditions ?? {});
    if (user) {
      parsedConds.strings.push('(note.is_public OR note.author_id = ?)');
      parsedConds.values.push(user.id);
    } else {
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
          ${options?.fullBody ? 'note.body' : 'SUBSTRING(note.body, 1, 255) AS body'}
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
    const notes = await executeQuery(queryString, parsedConds.values) as Note[];
    if (options?.limit === 1 && options?.connections && notes[0]) {
      notes[0].items = (notes[0].items ?? []).filter(val => val[0] !== null);
      notes[0].boards = (notes[0].boards ?? []).filter(val => val[0] !== null);
    }
    return notes;
  }

  async getByUsername(sessionUser: User | undefined, username: string, conditions?, options?): Promise<Note[]> {
    const user = await this.api.user.getOne({ 'user.username': username });
    if (!user) throw new NotFoundError();
    const notes = await this.getMany(
      sessionUser,
      { ...(conditions ?? {}), 'note.author_id': user.id },
      options ?? {},
    );
    return notes;
  }

  async getByItemShortname(
    user: User | undefined,
    universeShortname: string,
    itemShortname: string,
    conditions?: any,
    options?: NoteOptions,
    inclAuthors = false
  ): Promise<[Note[], User[]?]> {
    const item = await this.api.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.READ, true);
    const notes = await this.getMany(
      user,
      { ...conditions ?? {}, 'itemnote.item_id': item?.id },
      { ...options ?? {} },
    );
    if (inclAuthors) {
      const queryString2 = `
          SELECT user.id, user.username, user.email
          FROM user
          INNER JOIN note ON user.id = note.author_id
          INNER JOIN itemnote ON itemnote.note_id = note.id
          WHERE itemnote.item_id = ?
          GROUP BY user.id`;
      const users = await executeQuery(queryString2, [item.id]) as User[];
      return [notes, users];
    }
    return [notes];
  }

  async getBoardsByUniverseShortname(user: User | undefined, shortname: string): Promise<NoteBoard[]> {
    const universe = await this.api.universe.getOne(user, { 'universe.shortname': shortname }, perms.READ);
    const boards = await executeQuery('SELECT * FROM noteboard WHERE universe_id = ?', [universe.id]) as NoteBoard[];
    return boards;
  }

  async getByBoardShortname(user: User | undefined, shortname: string, conditions: any = null, options: any = null, validate = true, inclAuthors = false): Promise<Note[] | [Note[], { id: number, username: string, email: string }[]]> {
    const boards = await executeQuery('SELECT * FROM noteboard WHERE shortname = ?', [shortname]) as NoteBoard[];
    const board = boards[0];
    if (!board) throw new NotFoundError();
    if (validate) {
      await this.api.universe.getOne(user, { 'universe.id': board.universe_id }, perms.READ); // Make sure we have permission to see the universe
    }
    const notes = await this.getMany(
      user,
      { ...conditions ?? {}, 'boardnote.board_id': board.id },
      { ...options ?? {} },
    );
    if (inclAuthors) {
      const queryString2 = `
          SELECT user.id, user.username, user.email
          FROM user
          INNER JOIN note ON user.id = note.author_id
          INNER JOIN boardnote ON boardnote.note_id = note.id
          WHERE boardnote.board_id = ?
          GROUP BY user.id`;
      const users = await executeQuery(queryString2, [board.id]) as { id: number, username: string, email: string }[];
      return [notes, users];
    }
    return notes;
  }

  async postBoard(user: User | undefined, { title, shortname }, universeShortname: string): Promise<ResultSetHeader> {
    if (!user) throw new UnauthorizedError();
    const universe = await this.api.universe.getOne(user, { 'universe.shortname': universeShortname }, perms.WRITE);

    const queryString = `INSERT INTO noteboard (title, shortname, universe_id) VALUES (?, ?, ?);`;
    const data = await executeQuery<ResultSetHeader>(queryString, [title, shortname, universe.id]);
    return data;
  }

  async post(user: User | undefined, { title, body, is_public, tags }): Promise<string> {
    if (!user) throw new UnauthorizedError();
    const uuid = crypto.randomUUID();

    const queryString = `INSERT INTO note (uuid, title, body, is_public, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?);`;
    await executeQuery<ResultSetHeader>(queryString, [uuid, title, body, is_public, user.id, new Date(), new Date()]);

    const trimmedTags = tags.map(tag => tag[0] === '#' ? tag.substring(1) : tag);
    this.putTags(user, uuid, trimmedTags);

    return uuid;
  }

  async put(user: User | undefined, uuid: string, changes): Promise<ResultSetHeader> {
    if (!user) throw new UnauthorizedError();
    const { title, body, is_public, items, boards, tags } = changes;
    const note = await this.getOne(user, uuid);

    const queryString = `
        UPDATE note
        SET
          title = ?,
          body = ?,
          is_public = ?
        WHERE uuid = ?;
      `;
    const data = await executeQuery<ResultSetHeader>(queryString, [title, body, is_public, note.uuid]);

    await executeQuery('DELETE FROM itemnote WHERE note_id = ?', [note.id]);
    for (const { item, universe } of items ?? []) {
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

  async linkToBoard(user: User | undefined, boardShortname: string, noteUuid: string): Promise<void> {
    if (!noteUuid) throw new ValidationError('Note UUID is required');
    if (!user) throw new UnauthorizedError();
    const board = (await executeQuery('SELECT * FROM noteboard WHERE shortname = ?', [boardShortname]))[0] as NoteBoard | undefined;
    if (!board) throw new NotFoundError();
    const note = await this.getOne(user, noteUuid);

    const queryString = `INSERT INTO boardnote (board_id, note_id) VALUES (?, ?)`;
    await executeQuery(queryString, [board.id, note.id])
  }

  async linkToItem(user: User | undefined, universeShortname: string, itemShortname: string, noteUuid: string): Promise<void> {
    if (!noteUuid) throw new ValidationError('Note UUID is required');
    if (!user) throw new UnauthorizedError();
    const item = await this.api.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.WRITE, true)
    const note = await this.getOne(user, noteUuid);

    const queryString = `INSERT INTO itemnote (item_id, note_id) VALUES (?, ?)`;
    await executeQuery(queryString, [item.id, note.id])
  }

  async putTags(user: User, uuid: string, tags: string[]): Promise<boolean> {
    if (tags.length === 0) return false;
    const note = await this.getOne(user, uuid);
    const tagLookup = {};
    note.tags?.forEach(tag => {
      tagLookup[tag] = true;
    });
    const filteredTags = tags.filter(tag => !tagLookup[tag]);
    const valueString = filteredTags.map(() => `(?, ?)`).join(',');
    const valueArray = filteredTags.reduce((arr, tag) => [...arr, note.id, tag], []);
    if (!valueString) return false;
    const queryString = `INSERT INTO notetag (note_id, tag) VALUES ${valueString};`;
    const data = await executeQuery(queryString, valueArray);
    return true;
  }

  async delTags(user: User, uuid: string, tags: string[]): Promise<boolean> {
    if (tags.length === 0) return false;
    const note = await this.getOne(user, uuid);
    const whereString = tags.map(() => `tag = ?`).join(' OR ');
    if (!whereString) return false;
    const queryString = `DELETE FROM notetag WHERE note_id = ? AND (${whereString});`;
    const data = await executeQuery(queryString, [note.id, ...tags]);
    return true;
  }

  async del(user: User | undefined, uuid: string): Promise<ResultSetHeader> {
    if (!user) throw new UnauthorizedError();
    const note = await this.getOne(user, uuid);

    // getOne will only return a note if we own it, but it doesn't hurt to double check for clarity
    if (note.author_id !== user.id) throw new ForbiddenError();

    const data = await executeQuery<ResultSetHeader>('DELETE FROM note WHERE uuid = ?', [uuid]);

    return data;
  }
}
