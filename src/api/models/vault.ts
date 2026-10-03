import { sql } from 'kysely';
import { API } from '..';
import { ForbiddenError, ModelError, NotFoundError, UnauthorizedError, ValidationError } from '../../errors';
import { BaseOptions, perms, withTransaction } from '../utils';
import { kysely, Trx } from '../../db/kysely';
import { toRawSql } from '../../db/legacyCond';
import { User } from './user';

export type Vault = {
  id: number,
  universe_id: number,
  title: string,
  shortname: string,
  created_at: Date,
  updated_at: Date,
  authors: { [id: number]: string },
  author_permissions: { [id: number]: perms },
  requester_permissions: perms,
  items?: number,
};

type VaultOptions = BaseOptions & {
  itemCounts?: boolean,
};

export class VaultAPI {
  readonly api: API;

  constructor(api: API) {
    this.api = api;
  }

  async getOne(user: User | undefined, conditions, permissionLevel = perms.READ, options: VaultOptions = {}): Promise<Vault> {
    if (!conditions) throw new ValidationError('Conditions are required.');
    const data = await this.getMany(user, conditions, permissionLevel, options);
    const vault = data[0];
    if (!vault) {
      // TODO this existence check gets pretty hacky in Kysely, we should figure out something better...
      let existsQuery = kysely.selectFrom('vault').select(sql<number>`1`.as('one'));
      let valueIndex = 0;
      for (const str of conditions.strings) {
        const placeholderCount = (str.match(/\?/g) ?? []).length;
        const vals = conditions.values.slice(valueIndex, valueIndex + placeholderCount);
        valueIndex += placeholderCount;
        existsQuery = existsQuery.where(toRawSql<boolean>(str, vals));
      }
      const exists = (await existsQuery.limit(1).executeTakeFirst()) !== undefined;
      if (exists) {
        if (user) throw new ForbiddenError();
        else throw new UnauthorizedError();
      } else {
        throw new NotFoundError();
      }
    }
    return vault;
  }

  async getMany(user: User | undefined, conditions: any = null, permissionLevel = perms.READ, options: VaultOptions = {}): Promise<Vault[]> {
    if (!user) throw new UnauthorizedError();

    let query = kysely
      .selectFrom('vault')
      .leftJoin('vaultauthor as va_filter', (join) => join
        .onRef('vault.id', '=', 'va_filter.vault_id')
        .on('va_filter.user_id', '=', user.id))
      .leftJoin('authoruniverse as au_filter', (join) => join
        .onRef('vault.universe_id', '=', 'au_filter.universe_id')
        .on('au_filter.user_id', '=', user.id))
      .leftJoin('vaultauthor as va', 'va.vault_id', 'vault.id')
      .leftJoin('user as author', 'author.id', 'va.user_id')
      .select([
        'vault.id',
        'vault.universe_id',
        'vault.title',
        'vault.shortname',
        'vault.created_at',
        'vault.updated_at',
      ])
      .select(
        sql<{ [id: number]: string }>`JSON_REMOVE(JSON_OBJECTAGG(IFNULL(author.id, 'null__'), IFNULL(author.username, '')), '$.null__')`.as('authors'),
      )
      .select(
        sql<{ [id: number]: perms }>`JSON_REMOVE(JSON_OBJECTAGG(IFNULL(author.id, 'null__'), IFNULL(va.permission_level, 0)), '$.null__')`.as('author_permissions'),
      )
      .select(
        sql<perms>`GREATEST(
          IFNULL(MAX(va_filter.permission_level), ${perms.NONE}),
          IF(IFNULL(MAX(au_filter.permission_level), ${perms.NONE}) >= ${perms.OWNER}, ${perms.OWNER}, ${perms.NONE})
        )`.as('requester_permissions'),
      )
      .where((eb) => eb.or([
        eb('va_filter.permission_level', '>=', permissionLevel),
        eb('au_filter.permission_level', '>=', perms.OWNER),
      ]))
      .groupBy('vault.id')
      .orderBy('vault.title', 'asc')
      .$if(options.itemCounts === true, (qb) => qb
        .leftJoin('item', 'item.vault_id', 'vault.id')
        .select((eb) => eb.fn.count<number>('item.id').as('items')));

    // TODO more hacky condition stuff...
    let bridged: any = query;
    if (conditions) {
      let valueIndex = 0;
      for (const str of conditions.strings) {
        const placeholderCount = (str.match(/\?/g) ?? []).length;
        const vals = conditions.values.slice(valueIndex, valueIndex + placeholderCount);
        valueIndex += placeholderCount;
        bridged = bridged.where(toRawSql<boolean>(str, vals));
      }
    }
    query = bridged as typeof query;

    const data = await query.execute();
    return data;
  }

  async getManyByUniverseShortname(
    user: User | undefined,
    universeShortname: string,
    permissionLevel = perms.READ,
    options: VaultOptions = {}
  ): Promise<Vault[]> {
    const universe = await this.api.universe.getOne(user, { shortname: universeShortname });
    return this.getMany(user, {
      strings: ['vault.universe_id = ?'],
      values: [universe.id],
    }, permissionLevel, options);
  }

  getOneByShortnames(
    user: User | undefined,
    universeShortname: string,
    vaultShortname: string,
    permissionLevel = perms.READ,
    options: VaultOptions = {}
  ): Promise<Vault> {
    return this.getOne(user, {
      strings: ['vault.shortname = ?', 'vault.universe_id = (SELECT id FROM universe WHERE shortname = ?)'],
      values: [vaultShortname, universeShortname],
    }, permissionLevel, options);
  }

  validateShortname(shortname: string): string | null {
    return this.api.universe.validateShortname(shortname, ['create', 'perms']);
  }

  async post(user: User | undefined, universeShortname: string, body: { title: string, shortname: string }, conn?: Trx): Promise<{ insertId: number }> {
    if (!user) throw new UnauthorizedError();
    const { title, shortname } = body;

    if (!title) throw new ValidationError('Title is required.');
    const shortnameError = this.validateShortname(shortname);
    if (shortnameError) throw new ValidationError(shortnameError);

    const universe = await this.api.universe.getOne(user, { shortname: universeShortname }, perms.ADMIN);

    const insert = async (conn: Trx): Promise<{ insertId: number }> => {
      const data = await conn
        .insertInto('vault')
        .values({ universe_id: universe.id, title, shortname, created_at: new Date(), updated_at: new Date() })
        .executeTakeFirstOrThrow();

      await conn
        .insertInto('vaultauthor')
        .values({ vault_id: Number(data.insertId), user_id: user.id, permission_level: perms.OWNER })
        .execute();

      return { insertId: Number(data.insertId ?? 0) };
    };

    try {
      if (conn) return await insert(conn);
      let data!: { insertId: number };
      await withTransaction(async (trx) => { data = await insert(trx); });
      return data;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new ValidationError('Vault shortname must be unique within this universe.');
      throw err;
    }
  }

  async putPermissions(user: User | undefined, universeShortname: string, vaultShortname: string, targetUser: User, permission_level: perms): Promise<{ numDeletedRows: number } | { numUpdatedRows: number } | { insertId: number }> {
    if (!user) throw new UnauthorizedError();

    const vault = await this.getOneByShortnames(
      user,
      universeShortname,
      vaultShortname,
      permission_level === perms.OWNER ? perms.OWNER : Math.max(perms.ADMIN, permission_level + 1),
    );

    if ((vault.author_permissions[targetUser.id] ?? perms.NONE) > vault.requester_permissions) {
      throw new ForbiddenError();
    }

    if (targetUser.id in vault.author_permissions) {
      if (permission_level === perms.NONE) {
        const result = await kysely
          .deleteFrom('vaultauthor')
          .where('vault_id', '=', vault.id)
          .where('user_id', '=', targetUser.id)
          .executeTakeFirstOrThrow();
        return { numDeletedRows: Number(result.numDeletedRows) };
      } else {
        const result = await kysely
          .updateTable('vaultauthor')
          .set({ permission_level })
          .where('user_id', '=', targetUser.id)
          .where('vault_id', '=', vault.id)
          .executeTakeFirstOrThrow();
        return { numUpdatedRows: Number(result.numUpdatedRows) };
      }
    } else {
      const result = await kysely
        .insertInto('vaultauthor')
        .values({ permission_level, vault_id: vault.id, user_id: targetUser.id })
        .executeTakeFirstOrThrow();
      return { insertId: Number(result.insertId ?? 0) };
    }
  }

  async del(user: User | undefined, universeShortname: string, vaultShortname: string): Promise<void> {
    const vault = await this.getOneByShortnames(user, universeShortname, vaultShortname, perms.OWNER, { itemCounts: true });

    if (vault.items === undefined) {
      // We requested an item count but got none - abort.
      throw new ModelError('Internal server error while validating that vault is empty, aborting.');
    }

    if (vault.items > 0) {
      throw new ValidationError(
        `Cannot delete ${vault.title} while it still contains ${vault.items === 1 ? '1 item' : `${vault.items} items`}. `
        + 'Move them to another vault or out of the vault first.',
      );
    }

    await kysely.deleteFrom('vault').where('id', '=', vault.id).execute();
  }
}
