import { sql } from 'kysely';
import { API } from '..';
import embedder from '../../embedding';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../../errors';
import { typeConfigProblems, type TypeConfigs } from '../../lib/itemTypeConfig';
import type { TabLayout } from '../../lib/tabLayout';
import { IndexedDocument } from '../../lib/tiptapHelpers';
import { deepCompare } from '../../lib/utils';
import { BaseOptions, Tier, getPfpUrl, handleAsNull, parseData, perms, tierAllowance, tiers, withTransaction } from '../utils';
import { kysely, Trx } from '../../db/kysely';
import { toRawSql } from '../../db/legacyCond';
import { Item, ItemEvent } from './item';
import { User } from './user';

export type UniverseAccessRequest<T = boolean> = {
  universe_id: number,
  user_id: number,
  permission_level: perms,
  is_invite: T,
  inviter_id: number | null,
};

export type UniverseAccessRequestListing<T = boolean> = UniverseAccessRequest<T> & {
  username: string,
  inviter_username: string | null,
};

export type UserAccessInvite = {
  universe_shortname: string,
  universe_title: string,
  permission_level: perms,
  inviter_username: string | null,
};

export type UniverseObjData = {
  cats?: { [shortname: string]: [title: string, titlePl: string, color: string] },
  typeConfigs?: TypeConfigs,
  tabTypes?: { [id: string]: TabLayout },
  storiesEnabled?: boolean,
  semanticSearchEnabled?: boolean,
  theme?: string,
  customTheme?: { glass?: boolean, backgroundImage?: string },
  homePage?: boolean,
  publicPage?: boolean,
  [key: string]: unknown,
};

export type Universe = {
  id: number,
  title: string,
  shortname: string,
  author_id: number | null,
  created_at: Date,
  updated_at: Date,
  is_public: boolean,
  discussion_enabled: boolean,
  discussion_open: boolean,
  mcp_items_enabled: boolean,
  mcp_notes_enabled: boolean,
  mcp_discussions_enabled: boolean,
  obj_data: UniverseObjData,
  authors: { [id: number]: string },
  author_permissions: { [id: number]: perms },
  owner: string | null,
  followers: { [id: number]: boolean },
  tier: Tier,
  sponsoring_user: number | null,
};

const validateShortname = (shortname: string, reservedShortnames: string[] = ['create', 'news', '_home', '_public']) => {
  if (shortname.length < 3 || shortname.length > 64) {
    return 'Shortnames must be between 3 and 64 characters long.';
  }

  if (!/^[a-zA-Z0-9-]+$/.test(shortname)) {
    return 'Shortnames can only contain letters, numbers, and hyphens.';
  }

  if (/^[-]|[-]$/.test(shortname)) {
    return 'Shortnames cannot start or end with a dash.';
  }

  if (reservedShortnames.includes(shortname)) {
    return 'This shortname is reserved and cannot be used.';
  }

  return null;
};

const permText = {
  [perms.READ]: 'read',
  [perms.COMMENT]: 'comment',
  [perms.WRITE]: 'write',
  [perms.ADMIN]: 'admin',
  [perms.OWNER]: 'owner',
};

export class UniverseAPI {
  readonly api: API;
  readonly validateShortname = validateShortname;

  constructor(api: API) {
    this.api = api;
  }

  async getOne(user: User | undefined, conditions, permissionLevel = perms.READ): Promise<Universe> {
    if (!conditions) throw new ValidationError('Conditions are required.');
    const parsedConditions = parseData(conditions);
    const data = await this.getMany(user, parsedConditions, permissionLevel);
    const universe = data[0];
    if (!universe) {
      let existsQuery = kysely.selectFrom('universe').select(sql<number>`1`.as('one'));
      for (let i = 0; i < parsedConditions.strings.length; i++) {
        existsQuery = existsQuery.where(toRawSql<boolean>(parsedConditions.strings[i], [parsedConditions.values[i]]));
      }
      const exists = (await existsQuery.limit(1).executeTakeFirst()) !== undefined;
      if (exists) {
        if (user) throw new ForbiddenError();
        else throw new UnauthorizedError();
      } else {
        throw new NotFoundError();
      }
    }
    return universe;
  }

  async getMany(user: User | undefined, conditions: { strings: string[], values: any[] } | null = null, permissionLevel = perms.READ, options: BaseOptions = {}): Promise<Universe[]> {

    if (options.sort && !options.forceSort) {
      const validSorts = { 'title': true, 'created_at': true, 'updated_at': true };
      if (!validSorts[options.sort]) {
        delete options.sort;
      }
    }

    if (!user && permissionLevel > perms.READ) throw new ValidationError('User is required to access at above read-only permissions.');

    let query = kysely
      .selectFrom('universe')
      .innerJoin('authoruniverse as au_filter', (join) => join
        .onRef('universe.id', '=', 'au_filter.universe_id')
        .on((eb) => eb.or([
          ...(permissionLevel <= perms.READ ? [eb('universe.is_public', '=', true)] : []),
          ...(user ? [eb.and([
            eb('au_filter.user_id', '=', user.id),
            eb('au_filter.permission_level', '>=', permissionLevel),
          ])] : []),
        ])))
      .leftJoin('authoruniverse as au', 'au.universe_id', 'universe.id')
      .leftJoin('user as author', 'author.id', 'au.user_id')
      .leftJoin('followeruniverse as fu', 'fu.universe_id', 'universe.id')
      .leftJoin('user as owner', 'owner.id', 'universe.author_id')
      .leftJoin('usersponsoreduniverse as usu', 'usu.universe_id', 'universe.id')
      .select([
        'universe.id', 'universe.title', 'universe.shortname', 'universe.author_id',
        'universe.created_at', 'universe.updated_at', 'universe.is_public',
        'universe.discussion_enabled', 'universe.discussion_open',
        'universe.mcp_items_enabled', 'universe.mcp_notes_enabled', 'universe.mcp_discussions_enabled',
        'universe.obj_data',
        'owner.username as owner',
        'usu.user_id as sponsoring_user',
      ])
      .select(sql<Tier>`COALESCE(usu.tier, ${tiers.FREE})`.as('tier'))
      .select(sql<{ [id: number]: string }>`JSON_OBJECTAGG(author.id, author.username)`.as('authors'))
      .select(sql<{ [id: number]: perms }>`JSON_OBJECTAGG(author.id, au.permission_level)`.as('author_permissions'))
      .select(sql<{ [id: number]: boolean }>`
        JSON_REMOVE(JSON_OBJECTAGG(IFNULL(fu.user_id, 'null__'), fu.is_following), '$.null__')
      `.as('followers'))
      .groupBy('universe.id');

    // support the old-style `conditions`
    // TODO at some point we should clean this up
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

    query = options.sort
      ? query.orderBy(kysely.dynamic.ref(options.sort), options.sortDesc ? 'desc' : 'asc')
      : query.orderBy('universe.updated_at', 'desc');

    return query.execute();
  }

  getManyByAuthorId(user, authorId, permissionLevel = perms.WRITE): Promise<Universe[]> {
    return this.getMany(user, {
      strings: [`
        EXISTS (
          SELECT 1
          FROM authoruniverse as au_check
          WHERE au_check.universe_id = universe.id
          AND (au_check.user_id = ? AND au_check.permission_level >= ?)
        )
      `], values: [
        authorId,
        permissionLevel,
      ]
    });
  }

  getManyByAuthorName(user, authorName): Promise<Universe[]> {
    // `au_check` (authoruniverse) has no `username` column of its own - joined to `user` here to
    // compare against the real column. This method is currently unreachable from any caller, so
    // this was a pre-existing dead-code bug (always throwing `ER_BAD_FIELD_ERROR` if it were ever
    // invoked), not a behavior change for anything actually running.
    return this.getMany(user, {
      strings: [`
        EXISTS (
          SELECT 1
          FROM authoruniverse as au_check
          INNER JOIN user AS au_check_user ON au_check_user.id = au_check.user_id
          WHERE au_check.universe_id = universe.id
          AND (au_check_user.username = ? AND au_check.permission_level >= ?)
        )
      `], values: [
        authorName,
        perms.READ,
      ]
    });
  }

  async getEventsByUniverseShortname(user: User | undefined, shortname: string, permissionsRequired = perms.READ): Promise<ItemEvent[]> {
    const universe = await this.getOne(user, { 'universe.shortname': shortname }, permissionsRequired);

    const events = await kysely
      .selectFrom('itemevent')
      .innerJoin('item', 'item.id', 'itemevent.item_id')
      .select([
        'itemevent.event_title', 'itemevent.abstime',
        'item.shortname as src_shortname', 'item.title as src_title', 'item.id as src_id',
      ])
      .where('item.universe_id', '=', universe.id)
      .execute();
    return events;
  }

  // Does not throw if universe has no body..
  async getPublicBodyByShortname(shortname: string): Promise<IndexedDocument | void> {
    const universe = await kysely
      .selectFrom('universe')
      .select(['id', 'obj_data'])
      .where('shortname', '=', shortname)
      .executeTakeFirst();
    if (!universe) throw new NotFoundError();
    const objData = universe.obj_data as UniverseObjData;
    const publicPageEnabled = objData.publicPage;
    if (!publicPageEnabled) return;
    const item = await kysely
      .selectFrom('item')
      .select('obj_data')
      .where('universe_id', '=', universe.id)
      .where('shortname', '=', '_public')
      .executeTakeFirst();
    if (!item) throw new NotFoundError();
    const publicBody = (item.obj_data as Item['obj_data'])?.body;
    if (!publicBody) return;
    return publicBody;
  }

  async getTotalStoredByShortname(shortname: string): Promise<number> {
    const row = await kysely
      .selectFrom('universe')
      .innerJoin('item', 'item.universe_id', 'universe.id')
      .innerJoin('itemimage', 'itemimage.item_id', 'item.id')
      .innerJoin('image', 'image.id', 'itemimage.image_id')
      .select(sql<number | null>`SUM(OCTET_LENGTH(image.data))`.as('size'))
      .where('universe.shortname', '=', shortname)
      .groupBy('universe.title')
      .executeTakeFirst();
    return Number(row?.size);
  }

  async post(user: User | undefined, body): Promise<[{ insertId: number }, { insertId: number }]> {
    if (!user) throw new UnauthorizedError();

    try {
      const { title, shortname, is_public, discussion_enabled, discussion_open, mcp_items_enabled, mcp_notes_enabled, mcp_discussions_enabled, obj_data } = body;

      const shortnameError = this.validateShortname(shortname);
      if (shortnameError) throw new ValidationError(shortnameError);
      if (!title) throw new ValidationError('Title is required.');

      let data!: { insertId: number };
      let authorData!: { insertId: number };
      await withTransaction(async (trx) => {
        const inserted = await trx
          .insertInto('universe')
          .values({
            title,
            shortname,
            author_id: user.id,
            is_public,
            discussion_enabled,
            discussion_open,
            mcp_items_enabled: Boolean(mcp_items_enabled),
            mcp_notes_enabled: Boolean(mcp_notes_enabled),
            mcp_discussions_enabled: Boolean(mcp_discussions_enabled),
            // TODO tighten the type on obj_data here
            obj_data: typeof obj_data === 'string' ? obj_data : JSON.stringify(obj_data),
            created_at: new Date(),
            updated_at: new Date(),
          })
          .executeTakeFirstOrThrow();
        data = { insertId: Number(inserted.insertId ?? 0) };

        const insertedAuthor = await trx
          .insertInto('authoruniverse')
          .values({ universe_id: data.insertId, user_id: user.id, permission_level: perms.OWNER })
          .executeTakeFirstOrThrow();
        authorData = { insertId: Number(insertedAuthor.insertId ?? 0) };
      });

      return [data, authorData];
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new ValidationError('Universe shortname must be unique.');
      if (err.code === 'ER_BAD_NULL_ERROR') throw new ValidationError('Missing parameters.');
      throw err;
    }
  }

  async putUpdatedAtWithTransaction(conn: Trx, universeId: number, updatedAt: Date): Promise<void> {
    await conn.updateTable('universe').set({ updated_at: updatedAt }).where('id', '=', universeId).execute();
  }

  async put(user: User | undefined, universeShortname: string, changes): Promise<number> {
    const { title, shortname, is_public, discussion_enabled, discussion_open, mcp_items_enabled, mcp_notes_enabled, mcp_discussions_enabled, obj_data } = changes;

    if (!title) throw new ValidationError('Title is required.');
    const universe = await this.getOne(user, { shortname: universeShortname }, perms.WRITE);

    // MCP access toggles are a premium-tier feature; force them off on non-premium universes.
    const isPremium = universe.tier === tiers.PREMIUM;
    const mcpItems = isPremium && Boolean(mcp_items_enabled);
    const mcpNotes = isPremium && Boolean(mcp_notes_enabled);
    const mcpDiscussions = isPremium && Boolean(mcp_discussions_enabled);

    let parsedObjData: unknown;
    try {
      parsedObjData = typeof obj_data === 'string' ? JSON.parse(obj_data) : obj_data;
    } catch {
      throw new ValidationError('Universe data is not valid JSON.');
    }
    const typeProblems = typeConfigProblems(parsedObjData);
    if (typeProblems.length > 0) throw new ValidationError(typeProblems.slice(0, 5).join(' '));
    if (!isPremium && !deepCompare((parsedObjData as UniverseObjData | null)?.tabTypes ?? {}, universe.obj_data.tabTypes ?? {})) {
      // TODO might change our minds on this
      throw new ValidationError('Custom tab types require a premium universe.');
    }

    if (shortname !== null && shortname !== undefined && shortname !== universe.shortname) {
      // The item shortname has changed, we need to update all links to it to reflect this
      const shortnameError = this.validateShortname(shortname);
      if (shortnameError) throw new ValidationError(shortnameError);

      await kysely.updateTable('itemlink').set({ to_universe_short: shortname }).where('to_universe_short', '=', universe.shortname).execute();
    }

    await kysely
      .updateTable('universe')
      .set({
        title,
        shortname: shortname ?? universe.shortname,
        is_public,
        discussion_enabled,
        discussion_open,
        mcp_items_enabled: mcpItems,
        mcp_notes_enabled: mcpNotes,
        mcp_discussions_enabled: mcpDiscussions,
        obj_data: typeof obj_data === 'string' ? obj_data : JSON.stringify(obj_data),
        updated_at: new Date(),
      })
      .where('id', '=', universe.id)
      .execute();
    return universe.id;
  }

  async putData(user: User | undefined, universeShortname: string, changes: Record<string, any>): Promise<{ numUpdatedRows: number }> {
    if (!user) throw new UnauthorizedError();
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new ValidationError('Data must be an object.');

    const universe = await this.getOne(user, { shortname: universeShortname }, perms.WRITE);
    const obj_data = { ...universe.obj_data, ...changes };

    const result = await kysely
      .updateTable('universe')
      .set({ obj_data: JSON.stringify(obj_data), updated_at: new Date() })
      .where('id', '=', universe.id)
      .executeTakeFirstOrThrow();
    return { numUpdatedRows: Number(result.numUpdatedRows) };
  }

  async putPermissions(user: User | undefined, shortname: string, targetUser: User, permission_level: perms): Promise<{ numDeletedRows: number } | { numUpdatedRows: number } | { insertId: number }> {
    if (!user) throw new UnauthorizedError();

    // If we have a pending invite to this universe for the same permission level, use the admin who invited us to assign the new permission level.
    const accessInvite = await this.getUserAccessRequestIfExists(user, shortname);
    const validInvite = accessInvite?.is_invite && accessInvite.permission_level === permission_level && user.id === targetUser.id;
    const invitingAdmin = validInvite && await this.api.user.getOne({ 'user.id': accessInvite.inviter_id });

    const universe = await this.getOne(
      invitingAdmin || user,
      { shortname },
      permission_level === perms.OWNER ? perms.OWNER : Math.max(perms.ADMIN, permission_level + 1),
    );

    if (universe.author_permissions[targetUser.id] > universe.author_permissions[user.id]) throw new ForbiddenError();

    if (universe.author_permissions[targetUser.id] === perms.OWNER && permission_level < perms.OWNER) {
      let ownerWouldStillExist = false;
      for (const userID in universe.author_permissions) {
        if (Number(userID) !== Number(targetUser.id) && universe.author_permissions[userID] === perms.OWNER) {
          ownerWouldStillExist = true;
          break;
        }
      }
      if (!ownerWouldStillExist) throw new ValidationError('Cannot remove the last owner.');
    }

    let result: { numDeletedRows: number } | { numUpdatedRows: number } | { insertId: number };
    if (targetUser.id in universe.author_permissions) {
      if (permission_level === perms.NONE) {
        const deleted = await kysely
          .deleteFrom('authoruniverse')
          .where('universe_id', '=', universe.id)
          .where('user_id', '=', targetUser.id)
          .executeTakeFirstOrThrow();
        result = { numDeletedRows: Number(deleted.numDeletedRows) };
      } else {
        const updated = await kysely
          .updateTable('authoruniverse')
          .set({ permission_level })
          .where('user_id', '=', targetUser.id)
          .where('universe_id', '=', universe.id)
          .executeTakeFirstOrThrow();
        result = { numUpdatedRows: Number(updated.numUpdatedRows) };
      }
    } else {
      const inserted = await kysely
        .insertInto('authoruniverse')
        .values({ permission_level, universe_id: universe.id, user_id: targetUser.id })
        .executeTakeFirstOrThrow();
      result = { insertId: Number(inserted.insertId ?? 0) };
    }

    await kysely
      .deleteFrom('universeaccessrequest')
      .where('universe_id', '=', universe.id)
      .where('user_id', '=', targetUser.id)
      .execute();

    return result;
  }

  async putUserFollowing(user: User | undefined, shortname: string, isFollowing: boolean): Promise<{ numUpdatedRows: number } | { insertId: number }> {
    if (!user) throw new UnauthorizedError();
    const universe = await this.getOne(user, { shortname }, perms.READ);

    if (user.id in universe.followers) {
      const updated = await kysely
        .updateTable('followeruniverse')
        .set({ is_following: isFollowing })
        .where('user_id', '=', user.id)
        .where('universe_id', '=', universe.id)
        .executeTakeFirstOrThrow();
      return { numUpdatedRows: Number(updated.numUpdatedRows) };
    } else {
      const inserted = await kysely
        .insertInto('followeruniverse')
        .values({ is_following: isFollowing, universe_id: universe.id, user_id: user.id })
        .executeTakeFirstOrThrow();
      return { insertId: Number(inserted.insertId ?? 0) };
    }
  }

  async putUserSponsoring(user: User | undefined, shortname: string, tier: Tier): Promise<void> {
    if (!user) throw new UnauthorizedError();
    const universe = await this.getOne(user, { shortname }, perms.ADMIN);
    if (universe.sponsoring_user !== null && universe.sponsoring_user !== user.id) {
      await this.getOne(user, { shortname }, perms.OWNER); // check if we have owner permissions
    }
    if (universe.tier === tier) return; // Already at desired tier, do nothing

    if (tier === tiers.FREE) {
      if (universe.sponsoring_user === null) return; // Already free, do nothing
      await kysely.deleteFrom('usersponsoreduniverse').where('universe_id', '=', universe.id).execute();
    } else {
      if (user.plan === undefined || user.plan === null) throw new ValidationError('User plan is required.');
      const sponsored = await this.api.user.getSponsoredUniverses(user);
      const sponsoredAtTier = sponsored.filter(row => row.tier === tier)[0]?.universes.length;
      if (sponsoredAtTier >= tierAllowance[user.plan][tier]) throw new ForbiddenError();
      if (universe.sponsoring_user === null) {
        await kysely
          .insertInto('usersponsoreduniverse')
          .values({ universe_id: universe.id, user_id: user.id, tier })
          .execute();
      } else {
        await kysely
          .updateTable('usersponsoreduniverse')
          .set({ user_id: user.id, tier })
          .where('universe_id', '=', universe.id)
          .execute();
      }
    }
  }

  async getUserAccessRequestIfExists(user: User | undefined, shortname: string): Promise<UniverseAccessRequest<boolean | null> | null> {
    if (!user) throw new UnauthorizedError();

    const universe = await kysely.selectFrom('universe').selectAll().where('shortname', '=', shortname).executeTakeFirst();
    if (!universe) throw new NotFoundError();

    const request = await kysely
      .selectFrom('universeaccessrequest as ua')
      .innerJoin('user', 'user.id', 'ua.user_id')
      .selectAll('ua')
      .select('user.username')
      .where('ua.universe_id', '=', universe.id)
      .where('ua.user_id', '=', user.id)
      .executeTakeFirst();
    if (!request) return null;

    return request;
  }

  async getAccessRequests(user: User | undefined, shortname: string): Promise<UniverseAccessRequestListing<false>[]> {
    return this._getAccessRequests(user, shortname, false) as Promise<UniverseAccessRequestListing<false>[]>;
  }

  async getAccessInvites(user: User | undefined, shortname: string): Promise<UniverseAccessRequestListing<true>[]> {
    return this._getAccessRequests(user, shortname, true) as Promise<UniverseAccessRequestListing<true>[]>;
  }

  private async _getAccessRequests(user: User | undefined, shortname: string, getInvites: boolean): Promise<UniverseAccessRequestListing<boolean>[]> {
    if (!user) throw new UnauthorizedError();

    const universe = await this.getOne(user, { shortname }, perms.ADMIN);

    const requests = await kysely
      .selectFrom('universeaccessrequest as ua')
      .innerJoin('user', 'user.id', 'ua.user_id')
      .leftJoin('user as inviter', 'inviter.id', 'ua.inviter_id')
      .selectAll('ua')
      .select(['user.username', 'inviter.username as inviter_username'])
      .where('ua.universe_id', '=', universe.id)
      .where('ua.is_invite', '=', getInvites)
      .execute();

    return requests;
  }

  async getUserAccessInvites(user: User | undefined): Promise<UserAccessInvite[]> {
    if (!user) throw new UnauthorizedError();

    const invites = await kysely
      .selectFrom('universeaccessrequest as ua')
      .innerJoin('universe', 'universe.id', 'ua.universe_id')
      .leftJoin('user as inviter', 'inviter.id', 'ua.inviter_id')
      .select([
        'universe.shortname as universe_shortname', 'universe.title as universe_title',
        'ua.permission_level', 'inviter.username as inviter_username',
      ])
      .where('ua.user_id', '=', user.id)
      .where('ua.is_invite', '=', true)
      .orderBy('universe.title')
      .execute();
    return invites;
  }

  async putAccessRequest(user: User | undefined, shortname: string, permissionLevel: perms): Promise<void> {
    await this._putAccessRequest(user, shortname, permissionLevel);
    user = user as User;

    const universe = await kysely.selectFrom('universe').selectAll().where('shortname', '=', shortname).executeTakeFirstOrThrow();
    const target = await this.api.user.getOne({ 'user.id': universe.author_id }).catch(handleAsNull(NotFoundError));

    if (target) {
      await this.api.notification.notify(target, this.api.notification.types.UNIVERSE, {
        title: 'Universe Access Request',
        body: `${user.username} is requesting ${permText[permissionLevel]} permissions on your universe ${universe.title}.`,
        icon: getPfpUrl(user),
        clickUrl: `/universes/${universe.shortname}/permissions`,
      });
    }
  }

  async putAccessInvite(user: User | undefined, shortname: string, invitee: User, permissionLevel: perms): Promise<void> {
    const universe = await this.api.universe.getOne(user, { shortname }, Math.max(perms.ADMIN, permissionLevel)); // Validate we have permssion to invite.
    user = user as User;
    const inviteChanged = await this._putAccessRequest(invitee, universe.shortname, permissionLevel, user);

    if (inviteChanged) {
      await this.api.notification.notify(invitee, this.api.notification.types.UNIVERSE, {
        title: `Invitation to ${universe.title}`,
        body: `${user.username} is inviting you to ${universe.title} with ${permText[permissionLevel]} permissions.`,
        icon: getPfpUrl(user),
        clickUrl: `/universes/${universe.shortname}`,
      }, `invite-${shortname}-${invitee.username}`);
    }
  }

  private async _putAccessRequest(user: User | undefined, shortname: string, permissionLevel: perms, invitingAdmin?: User): Promise<boolean> {
    if (!user) throw new UnauthorizedError();

    const universe = await kysely.selectFrom('universe').selectAll().where('shortname', '=', shortname).executeTakeFirst();
    if (!universe) throw new NotFoundError();

    const request = await this.getUserAccessRequestIfExists(user, shortname);
    if (request) {
      if (request.permission_level >= permissionLevel) return false;
      else await this.delAccessRequest(user, shortname, user);
    }

    await kysely
      .insertInto('universeaccessrequest')
      .values({
        universe_id: universe.id, user_id: user.id, permission_level: permissionLevel,
        is_invite: invitingAdmin !== undefined, inviter_id: invitingAdmin?.id ?? null,
      })
      .execute();

    return true;
  }

  async delAccessRequest(user: User | undefined, shortname: string, requestingUser: User): Promise<void> {
    if (!user) throw new UnauthorizedError();
    if (!requestingUser) throw new ValidationError('Requesting user is required.');
    const permsUniverse = await this.getOne(user, { shortname }, perms.ADMIN).catch(handleAsNull(ForbiddenError));
    if (!(permsUniverse || (user.id === requestingUser.id))) throw new ForbiddenError();

    const universe = await kysely.selectFrom('universe').selectAll().where('shortname', '=', shortname).executeTakeFirstOrThrow();
    await kysely
      .deleteFrom('universeaccessrequest')
      .where('universe_id', '=', universe.id)
      .where('user_id', '=', requestingUser.id)
      .execute();
  }

  async del(user: User | undefined, shortname: string): Promise<void> {
    const universe = await this.getOne(user, { shortname }, perms.OWNER);

    await withTransaction(async (trx) => {
      // More DELETE-with-JOINs that Kysely doesn't support
      await sql`
        DELETE comment
        FROM comment
        INNER JOIN threadcomment AS tc ON tc.comment_id = comment.id
        INNER JOIN discussion ON tc.thread_id = discussion.id
        WHERE discussion.universe_id = ${universe.id}
      `.execute(trx);
      await sql`
        DELETE comment
        FROM comment
        INNER JOIN itemcomment AS ic ON ic.comment_id = comment.id
        INNER JOIN item ON ic.item_id = item.id
        WHERE item.universe_id = ${universe.id}
      `.execute(trx);
      await trx.deleteFrom('universe').where('id', '=', universe.id).execute();
    });

    await embedder.deleteForUniverse(universe.id);
  }
}
