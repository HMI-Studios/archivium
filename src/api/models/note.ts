import crypto from 'crypto';
import { sql } from 'kysely';
import { API } from "..";
import { kysely } from '../../db/kysely';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "../../errors";
import { IndexedDocument } from "../../lib/tiptapHelpers";
import { BaseOptions, perms } from '../utils';
import { CommenterUserBasic } from './discussion';
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
  is_public: boolean | null,
  universe_id: number,
};

export type Note = {
  id: number,
  uuid: string,
  title: string | null,
  body: IndexedDocument | string | null,
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
  async getMany(user: User | undefined, conditions: { [key: string]: any } | undefined, options: NoteOptions): Promise<Note[]> {
    const search = options?.search;

    let query = kysely
      .selectFrom('note')
      .distinct()
      .leftJoin('itemnote', 'itemnote.note_id', 'note.id')
      .leftJoin('boardnote', 'boardnote.note_id', 'note.id')
      .leftJoin(
        (eb) => eb
          .selectFrom('notetag')
          .select((eb2) => [eb2.fn<string[]>('JSON_ARRAYAGG', [eb2.ref('notetag.tag')]).as('tags')])
          .select('notetag.note_id')
          .groupBy('notetag.note_id')
          .as('tag'),
        (join) => join.onRef('tag.note_id', '=', 'note.id'),
      )
      .select([
        'note.id', 'note.uuid', 'note.title', 'note.is_public', 'note.author_id',
        'note.created_at', 'note.updated_at', 'tag.tags',
      ])
      .$if(options?.fullBody === true, (qb) => qb.select('note.body'))
      .$if(options?.fullBody !== true, (qb) => qb.select(
        sql<string | null>`SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(note.body, '$.text')), 1, 255)`.as('body'),
      ))
      .$if(options?.connections === true, (qb) => qb
        .leftJoin(
          (eb) => eb
            .selectFrom('itemnote as conn_itemnote')
            .innerJoin('item', 'item.id', 'conn_itemnote.item_id')
            .innerJoin('universe as iu', 'iu.id', 'item.universe_id')
            .select((eb2) => [eb2.fn<NoteItemTuple[]>('JSON_ARRAYAGG', [
              sql`JSON_ARRAY(item.title, item.shortname, iu.title, iu.shortname)`,
            ]).as('items')])
            .select('conn_itemnote.note_id')
            .groupBy('conn_itemnote.note_id')
            .as('item_conn'),
          (join) => join.onRef('item_conn.note_id', '=', 'note.id'),
        )
        .leftJoin(
          (eb) => eb
            .selectFrom('boardnote as conn_boardnote')
            .innerJoin('noteboard', 'noteboard.id', 'conn_boardnote.board_id')
            .innerJoin('universe as nu', 'nu.id', 'noteboard.universe_id')
            .select((eb2) => [eb2.fn<NoteBoardTuple[]>('JSON_ARRAYAGG', [
              sql`JSON_ARRAY(noteboard.title, noteboard.shortname, nu.title, nu.shortname)`,
            ]).as('boards')])
            .select('conn_boardnote.note_id')
            .groupBy('conn_boardnote.note_id')
            .as('board_conn'),
          (join) => join.onRef('board_conn.note_id', '=', 'note.id'),
        )
        .select(['item_conn.items', 'board_conn.boards'])
        .groupBy('note.id'))
      .$if(search !== undefined && search !== '', (qb) => qb
        .select(sql<number>`LOCATE(${search}, note.body)`.as('match_pos'))
        .select(sql<string | null>`SUBSTRING(note.body, GREATEST(1, LOCATE(${search}, note.body) - 50), 100)`.as('snippet')))
      .$if(conditions !== undefined && conditions !== null, (qb) => {
        let q = qb;
        for (const [key, value] of Object.entries(conditions ?? {})) {
          if (value === undefined) continue;
          q = q.where(kysely.dynamic.ref(key), '=', value);
        }
        return q;
      })
      .where((eb) => user
        ? eb.or([eb('note.is_public', '=', true), eb('note.author_id', '=', user.id)])
        : eb('note.is_public', '=', true))
      .$if(search !== undefined && search !== '', (qb) => qb.where((eb) => eb.or([
        eb('note.title', 'like', `%${search}%`),
        sql<boolean>`note.body LIKE ${`%${search}%`}`,
        sql<boolean>`tag.tags LIKE ${`%${search}%`}`,
      ])))
      .$if(Boolean(options?.limit), (qb) => qb.limit(options.limit!));

    const notes = await query.execute();
    if (options?.limit === 1 && options?.connections && notes[0]) {
      notes[0].items = (notes[0].items ?? []).filter(val => val[0] !== null);
      notes[0].boards = (notes[0].boards ?? []).filter(val => val[0] !== null);
    }

    // TODO would be great if we could drop this cast, but that requires getting rid of the fullBody option...
    return notes as Note[];
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
  ): Promise<[Note[], CommenterUserBasic[]?]> {
    const item = await this.api.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.READ, true);
    const notes = await this.getMany(
      user,
      { ...conditions ?? {}, 'itemnote.item_id': item?.id },
      { ...options ?? {} },
    );
    if (inclAuthors) {
      const users = await kysely
        .selectFrom('user')
        .innerJoin('note', 'note.author_id', 'user.id')
        .innerJoin('itemnote', 'itemnote.note_id', 'note.id')
        .leftJoin('userimage as ui', 'ui.user_id', 'user.id')
        .select((eb) => ['user.id', 'user.username', 'user.email', eb('ui.user_id', 'is not', null).as('hasPfp')])
        .where('itemnote.item_id', '=', item.id)
        .groupBy('user.id')
        .execute();
      return [notes, users];
    }
    return [notes];
  }

  async getBoardsByUniverseShortname(user: User | undefined, shortname: string): Promise<NoteBoard[]> {
    const universe = await this.api.universe.getOne(user, { 'universe.shortname': shortname }, perms.READ);
    const boards = await kysely
      .selectFrom('noteboard')
      .selectAll()
      .where('universe_id', '=', universe.id)
      .execute();
    return boards;
  }

  async getByBoardShortname(user: User | undefined, shortname: string, conditions: any = null, options: any = null, validate = true, inclAuthors = false): Promise<Note[] | [Note[], { id: number, username: string, email: string }[]]> {
    const board = await kysely
      .selectFrom('noteboard')
      .selectAll()
      .where('shortname', '=', shortname)
      .executeTakeFirst();
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
      const users = await kysely
        .selectFrom('user')
        .innerJoin('note', 'note.author_id', 'user.id')
        .innerJoin('boardnote', 'boardnote.note_id', 'note.id')
        .select(['user.id', 'user.username', 'user.email'])
        .where('boardnote.board_id', '=', board.id)
        .groupBy('user.id')
        .execute();
      return [notes, users];
    }
    return notes;
  }

  async postBoard(user: User | undefined, { title, shortname }, universeShortname: string): Promise<{ insertId: number }> {
    if (!user) throw new UnauthorizedError();
    const universe = await this.api.universe.getOne(user, { 'universe.shortname': universeShortname }, perms.WRITE);

    const result = await kysely
      .insertInto('noteboard')
      .values({ title, shortname, universe_id: universe.id })
      .executeTakeFirstOrThrow();
    return { insertId: Number(result.insertId ?? 0) };
  }

  async post(user: User | undefined, { title, body, is_public, tags }: Partial<Note>): Promise<string> {
    if (!user) throw new UnauthorizedError();
    const uuid = crypto.randomUUID();

    if (title === undefined || is_public === undefined) throw new ValidationError('Missing required fields.');

    await kysely
      .insertInto('note')
      .values({
        uuid, title, body: body ? JSON.stringify(body) : null, is_public,
        author_id: user.id, created_at: new Date(), updated_at: new Date(),
      })
      .execute();

    if (tags) {
      const trimmedTags = tags.map(tag => tag[0] === '#' ? tag.substring(1) : tag);
      this.putTags(user, uuid, trimmedTags);
    }

    return uuid;
  }

  async put(user: User | undefined, uuid: string, changes: Partial<Note>): Promise<{ numUpdatedRows: number }> {
    if (!user) throw new UnauthorizedError();
    const { title, body, is_public, items, boards, tags } = changes;
    if (title === undefined || is_public === undefined) throw new ValidationError();
    const note = await this.getOne(user, uuid);

    const result = await kysely
      .updateTable('note')
      .set({ title, body: body ? JSON.stringify(body) : null, is_public })
      .where('uuid', '=', note.uuid)
      .executeTakeFirstOrThrow();

    await kysely.deleteFrom('itemnote').where('note_id', '=', note.id).execute();
    for (const [, item,, universe] of items ?? []) {
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

    return { numUpdatedRows: Number(result.numUpdatedRows) };
  }

  async linkToBoard(user: User | undefined, boardShortname: string, noteUuid: string): Promise<void> {
    if (!noteUuid) throw new ValidationError('Note UUID is required');
    if (!user) throw new UnauthorizedError();
    const board = await kysely
      .selectFrom('noteboard')
      .selectAll()
      .where('shortname', '=', boardShortname)
      .executeTakeFirst();
    if (!board) throw new NotFoundError();
    const note = await this.getOne(user, noteUuid);

    await kysely.insertInto('boardnote').values({ board_id: board.id, note_id: note.id }).execute();
  }

  async linkToItem(user: User | undefined, universeShortname: string, itemShortname: string, noteUuid: string): Promise<void> {
    if (!noteUuid) throw new ValidationError('Note UUID is required');
    if (!user) throw new UnauthorizedError();
    const item = await this.api.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, perms.READ, true)
    const note = await this.getOne(user, noteUuid);

    await kysely.insertInto('itemnote').values({ item_id: item.id, note_id: note.id }).execute();
  }

  async putTags(user: User, uuid: string, tags: string[]): Promise<boolean> {
    if (tags.length === 0) return false;
    const note = await this.getOne(user, uuid);
    const tagLookup = {};
    note.tags?.forEach(tag => {
      tagLookup[tag] = true;
    });
    const filteredTags = tags.filter(tag => !tagLookup[tag]);
    if (filteredTags.length === 0) return false;
    await kysely
      .insertInto('notetag')
      .values(filteredTags.map(tag => ({ note_id: note.id, tag })))
      .execute();
    return true;
  }

  async delTags(user: User, uuid: string, tags: string[]): Promise<boolean> {
    if (tags.length === 0) return false;
    const note = await this.getOne(user, uuid);
    await kysely
      .deleteFrom('notetag')
      .where('note_id', '=', note.id)
      .where('tag', 'in', tags)
      .execute();
    return true;
  }

  async del(user: User | undefined, uuid: string): Promise<{ numDeletedRows: number }> {
    if (!user) throw new UnauthorizedError();
    const note = await this.getOne(user, uuid);

    // getOne will only return a note if we own it, but it doesn't hurt to double check for clarity
    if (note.author_id !== user.id) throw new ForbiddenError();

    const result = await kysely.deleteFrom('note').where('uuid', '=', uuid).executeTakeFirstOrThrow();

    return { numDeletedRows: Number(result.numDeletedRows) };
  }
}
