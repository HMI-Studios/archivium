import { sql } from 'kysely';
import { kysely } from '../../db/kysely';
import utils from '../../lib/hashUtils';
import { API } from '..';
import { User } from './user';

export type Session = {
  id: number;
  hash: string;
  user_id?: number;
  created_at: Date;
  user?: User;
};

export type SessionConditions = {
  id?: number;
  hash?: string;
  user_id?: number;
  created_at?: Date;
};

export type SessionChanges = {
  user_id: number | null;
};

export class SessionAPI {
  readonly api: API;

  constructor(api: API) {
    this.api = api;
  }

  // Unlike other models, this one will not throw on missing data, but will return undefined instead.
  async getOne(options: SessionConditions): Promise<Session | undefined> {
    const row = await kysely
      .selectFrom('session')
      .selectAll()
      .$if(options.id !== undefined, (qb) => qb.where('id', '=', options.id!))
      .$if(options.hash !== undefined, (qb) => qb.where('hash', '=', options.hash!))
      .$if(options.user_id !== undefined, (qb) => qb.where('user_id', '=', options.user_id!))
      .$if(options.created_at !== undefined, (qb) => qb.where('created_at', '=', options.created_at!))
      .limit(1)
      .executeTakeFirst();
    if (!row) return undefined;
    if (!row.user_id) return { id: row.id, hash: row.hash, created_at: row.created_at };
    const user = await this.api.user.getOne({ 'user.id': row.user_id }, true);
    return { id: row.id, hash: row.hash, created_at: row.created_at, user_id: row.user_id, user };
  }

  async post(): Promise<{ insertId: number }> {
    const data = utils.createRandom32String();
    const hash = utils.createHash(data);
    const result = await kysely
      .insertInto('session')
      .values({ hash, created_at: new Date() })
      .executeTakeFirstOrThrow();
    return { insertId: Number(result.insertId ?? 0) };
  }

  async put(options: SessionConditions, changes: SessionChanges): Promise<{ numUpdatedRows: number }> {
    const result = await kysely
      .updateTable('session')
      .set({ user_id: changes.user_id })
      .$if(options.id !== undefined, (qb) => qb.where('id', '=', options.id!))
      .$if(options.hash !== undefined, (qb) => qb.where('hash', '=', options.hash!))
      .$if(options.user_id !== undefined, (qb) => qb.where('user_id', '=', options.user_id!))
      .$if(options.created_at !== undefined, (qb) => qb.where('created_at', '=', options.created_at!))
      .executeTakeFirstOrThrow();
    return { numUpdatedRows: Number(result.numUpdatedRows) };
  }

  async del(options: SessionConditions): Promise<{ numDeletedRows: number }> {
    const result = await kysely
      .deleteFrom('session')
      .$if(options.id !== undefined, (qb) => qb.where('id', '=', options.id!))
      .$if(options.hash !== undefined, (qb) => qb.where('hash', '=', options.hash!))
      .$if(options.user_id !== undefined, (qb) => qb.where('user_id', '=', options.user_id!))
      .$if(options.created_at !== undefined, (qb) => qb.where('created_at', '=', options.created_at!))
      .executeTakeFirstOrThrow();
    return { numDeletedRows: Number(result.numDeletedRows) };
  }

  async purge(): Promise<{ affectedRows: number }> {
    const result = await kysely
      .deleteFrom('session')
      .where('created_at', '<', sql<Date>`NOW() - INTERVAL 8 DAY`)
      .executeTakeFirstOrThrow();
    return { affectedRows: Number(result.numDeletedRows) };
  }
}
