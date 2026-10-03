import { sql } from 'kysely';
import { withTransaction, perms, plans } from '../utils';
import { kysely } from '../../db/kysely';
import utils from '../../lib/hashUtils';
import logger from '../../logger';
import { SITE_OWNER_EMAIL } from '../../config';
import { API } from '..';
import { RequestError, ModelError, ValidationError, UnauthorizedError, ForbiddenError, NotFoundError } from '../../errors';
import { HttpStatusCode } from 'axios';
import { Theme, ThemeName } from '../../themes';

export type UserSponsoredUniverses = { tier: number, universes: string[], universe_shorts: string[] }[];

export type UserImage = {
  id: number,
  name: string,
  mimetype: string,
  data: Buffer,
};

export type BasicUser = {
  id: number,
  username: string,
  created_at: Date,
  updated_at: Date,
  isContact: boolean,
  hasPfp: boolean,
  pfpUrl?: string,
};

export type User = BasicUser & {
  email: string,
  verified: boolean | null,
  suspect: boolean | null,
  email_notifications: boolean | null,
  preferred_theme: ThemeName | null,
  custom_theme: Theme | null,
  plan: plans | null,
  notifications: number,
};

export type AuthUser = User & {
  password: string,
  salt: string,
};

const validateUsername = (username: string) => {
  const RESERVED_USERNAMES = ['admin', 'moderator', 'root', 'support', 'system'];

  if (username.length < 3 || username.length > 32) {
    return 'Username must be between 3 and 32 characters long.';
  }

  if (RESERVED_USERNAMES.includes(username)) {
      return 'This username is reserved and cannot be used.';
  }

  if (/^\d+$/.test(username)) {
      return 'Usernames cannot be only numbers.';
  }

  if (/[-_]{2,}/.test(username)) {
    return 'Usernames cannot have consecutive dashes or underscores.';
  }

  if (/^[-]|[-]$/.test(username)) {
    return 'Usernames cannot start or end with a dash.';
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return 'Usernames can only contain letters, numbers, underscores, and hyphens.';
  }

  return null;
}

export class UserImageAPI {
  readonly user: UserAPI;

  constructor(user: UserAPI) {
    this.user = user;
  }

  async getByUsername(username: string): Promise<UserImage | undefined> {
    const user = await this.user.getOne({ 'user.username': username });
    if (!user) throw new NotFoundError();
    const image = await kysely
      .selectFrom('userimage as ui')
      .innerJoin('image', 'image.id', 'ui.image_id')
      .select(['image.id', 'image.name', 'image.mimetype', 'image.data'])
      .where('ui.user_id', '=', user.id)
      .executeTakeFirst();
    return image;
  }

  async post(sessionUser: User | undefined, file: Express.Multer.File | undefined, username: string): Promise<{ insertId: number }> {
    if (!file) throw new ValidationError('No file provided');
    if (!sessionUser) throw new UnauthorizedError();
    if (sessionUser.username !== username) throw new ForbiddenError();

    const { originalname, buffer, mimetype } = file;
    const user = await this.user.getOne({ 'user.username': username });

    let data!: { insertId: number };
    await withTransaction(async (trx) => {
      // More DELETE-with-JOINs that Kysely doesn't support
      await sql`
        DELETE image FROM image
        INNER JOIN userimage AS ui ON ui.image_id = image.id
        WHERE ui.user_id = ${user.id}
      `.execute(trx);

      const inserted = await trx
        .insertInto('image')
        .values({ name: originalname.substring(0, 64), mimetype, data: buffer })
        .executeTakeFirstOrThrow();
      data = { insertId: Number(inserted.insertId ?? 0) };

      await trx.insertInto('userimage').values({ user_id: user.id, image_id: data.insertId }).execute();
    });
    return data;
  }

  async del(sessionUser: User | undefined, username: string): Promise<void> {
    if (!sessionUser) throw new UnauthorizedError();
    if (sessionUser.username !== username) throw new ForbiddenError();
    const user = await this.user.getOne({ 'user.username': username });
    await sql`
      DELETE image FROM image
      INNER JOIN userimage AS ui ON ui.image_id = image.id
      WHERE ui.user_id = ${user.id}
    `.execute(kysely);
  }
}

export class UserAPI {
  readonly image: UserImageAPI;
  readonly validateUsername = validateUsername;
  readonly api: API;

  constructor(api: API) {
    this.image = new UserImageAPI(this);
    this.api = api;
  }

  toBasicUser(user: User): BasicUser {
    return {
      id: user.id,
      username: user.username,
      created_at: user.created_at,
      updated_at: user.updated_at,
      isContact: user.isContact,
      hasPfp: user.hasPfp,
      pfpUrl: user.pfpUrl,
    };
  }

  private async fetchUser<T extends User>(options: { [key: string]: any }, includeAuth = false, includeNotifs = false): Promise<T> {
    if (!options || Object.keys(options).length === 0) throw new ValidationError('options required for api.get.user');

    let query = kysely
      .selectFrom('user')
      .leftJoin('userimage as ui', 'ui.user_id', 'user.id')
      .leftJoin('userplan as up', 'up.user_id', 'user.id')
      .select([
        'user.id', 'user.username', 'user.email', 'user.created_at', 'user.updated_at',
        'user.verified', 'user.suspect', 'user.email_notifications', 'user.preferred_theme', 'user.custom_theme',
        'up.plan',
      ])
      .select(sql<boolean>`(ui.user_id IS NOT NULL)`.as('hasPfp'))
      .$if(includeAuth, (qb) => qb.select(['user.password', 'user.salt']))
      .$if(includeNotifs, (qb) => qb
        .leftJoin('sentnotification as notif', (join) => join
          .onRef('notif.user_id', '=', 'user.id')
          .on('notif.is_read', '=', false))
        .select((eb) => eb.fn.count<number>('notif.id').as('notifications')))
      .groupBy(['user.id', 'up.plan']);

    for (const [key, value] of Object.entries(options)) {
      if (value === undefined) continue;
      query = query.where(kysely.dynamic.ref(key), '=', value);
    }

    const user = await query.limit(1).executeTakeFirst();
    if (!user) throw new NotFoundError();
    return user as T;
  }

  /**
   * returns a "safe" version of the user object
   * @param {*} options
   * @returns {Promise<User>}
   */
  getOne(options: any, includeNotifs=false): Promise<User> {
    return this.fetchUser<User>(options, false, includeNotifs);
  }

  /**
   *
   * @param {*} options
   * @returns {Promise<User>}
   */
  getOneWithAuth(options: any, includeNotifs=false): Promise<AuthUser> {
    return this.fetchUser<AuthUser>(options, true, includeNotifs);
  }

  /**
   * 
   * @param {*} options
   * @returns {Promise<Pick<User, 'id' | 'username' | 'created_at' | 'updated_at'> & Partial<Pick<User, 'email' | 'hasPfp'>>>[]}
   */
  async getMany(
    options: { [key: string]: any } | null = null,
    includeEmail = false,
  ): Promise<(Pick<User, 'id' | 'username' | 'created_at' | 'updated_at'> & Partial<Pick<User, 'email' | 'hasPfp'>>)[]> {
    let query = kysely
      .selectFrom('user')
      .select(['user.id', 'user.username', 'user.created_at', 'user.updated_at'])
      .$if(includeEmail, (qb) => qb.select('user.email'))
      .$if(options !== undefined && options !== null, (qb) => qb
        .leftJoin('userimage as ui', 'ui.user_id', 'user.id')
        .select(sql<boolean>`(ui.user_id IS NOT NULL)`.as('hasPfp')));

    if (options) {
      for (const [key, value] of Object.entries(options)) {
        if (value === undefined) continue;
        query = query.where(kysely.dynamic.ref(key), '=', value);
      }
    }

    return await query.execute();
  }

  async getByUniverseShortname(
    user: User | undefined,
    shortname: string,
  ): Promise<(Pick<User, 'id' | 'username' | 'created_at' | 'updated_at' | 'email' | 'plan' | 'hasPfp'> & { items_authored: number })[]> {
    const universe = await this.api.universe.getOne(user, { shortname });
    return await kysely
      .selectFrom('user')
      .innerJoin('authoruniverse as au', 'au.user_id', 'user.id')
      .leftJoin('item', (join) => join
        .onRef('item.universe_id', '=', 'au.universe_id')
        .onRef('item.author_id', '=', 'user.id'))
      .leftJoin('userimage as ui', 'ui.user_id', 'user.id')
      .leftJoin('userplan', 'userplan.user_id', 'user.id')
      .select([
        'user.id', 'user.username', 'user.created_at', 'user.updated_at', 'user.email', 'userplan.plan',
      ])
      .select((eb) => eb.fn.count<number>('item.id').as('items_authored'))
      .select(sql<boolean>`(ui.user_id IS NOT NULL)`.as('hasPfp'))
      .where('au.universe_id', '=', universe.id)
      .groupBy(['user.id', 'userplan.plan'])
      .execute();
  }

  async getSponsoredUniverses(user: User | undefined): Promise<UserSponsoredUniverses> {
    if (!user) throw new ValidationError('User required');
    const universes = await kysely
      .selectFrom('usersponsoreduniverse as usu')
      .innerJoin('universe', 'universe.id', 'usu.universe_id')
      .select('usu.tier')
      .select(sql<string[]>`JSON_ARRAYAGG(universe.title)`.as('universes'))
      .select(sql<string[]>`JSON_ARRAYAGG(universe.shortname)`.as('universe_shorts'))
      .where('usu.user_id', '=', user.id)
      .groupBy('usu.tier')
      .execute();
    return universes;
  }

  async post({ username, email, password, hp }: any): Promise<{ insertId: number }> {
    const salt = utils.createRandom32String();

    if (!username) throw new Error('username is required');
    if (!email) throw new Error('email is required');
    if (!password) throw new Error('empty password not allowed');

    const validationError = this.validateUsername(username);
    if (validationError) throw new Error(validationError);

    const suspect = hp !== '';

    const result = await kysely
      .insertInto('user')
      .values({
        username,
        email,
        salt,
        password: utils.createHash(password, salt),
        created_at: new Date(),
        updated_at: new Date(),
        suspect,
      })
      .executeTakeFirstOrThrow();
    return { insertId: Number(result.insertId ?? 0) };
  }

  /**
   *
   * @param {*} attempted
   * @param {*} password
   * @param {*} salt
   * @returns
   */
  validatePassword(attempted: any, password: any, salt: any) {
    return utils.compareHash(attempted, password, salt);
  }

  /**
   *
   * @param {*} user_id
   * @param {*} userIDToPut
   * @param {{ updated_at?, verified? }} param2
   * @returns
   */
  async put(user_id: any, userIDToPut: any, { updated_at, verified }: { updated_at?; verified?; }) {
    if (Number(user_id) !== Number(userIDToPut)) return [403];

    const setObj: { updated_at?: Date, verified?: boolean } = {};
    if (updated_at !== undefined) setObj.updated_at = updated_at;
    if (verified !== undefined) setObj.verified = verified;

    const result = await kysely.updateTable('user').set(setObj).where('id', '=', userIDToPut).executeTakeFirstOrThrow();
    return [200, { numUpdatedRows: Number(result.numUpdatedRows) }];
  }

  async putPreferences(sessionUser: User | undefined, username: string, body: { preferred_theme: string, custom_theme: Theme }): Promise<{ numUpdatedRows: number }> {
    if (!sessionUser) throw new UnauthorizedError();
    const { preferred_theme, custom_theme } = body;
    const user = await this.getOne({ 'user.username': username });
    if (Number(sessionUser.id) !== Number(user.id)) throw new ForbiddenError();

    const setObj: { preferred_theme?: string, custom_theme?: string | null } = {};
    if (preferred_theme !== undefined) setObj.preferred_theme = preferred_theme;
    if (custom_theme !== undefined) {
      setObj.custom_theme = custom_theme === null || typeof custom_theme === 'string' ? custom_theme : JSON.stringify(custom_theme);
    }
    if (Object.keys(setObj).length === 0) throw new ValidationError('No changes provided');

    const result = await kysely.updateTable('user').set(setObj).where('id', '=', user.id).executeTakeFirstOrThrow();
    return { numUpdatedRows: Number(result.numUpdatedRows) };
  }

  async putUsername(sessionUser: User | undefined, oldUsername: string, newUsername: string): Promise<Date | { numUpdatedRows: number } | string> {
    const user = await this.getOne({ 'user.username': oldUsername });
    if (!user) throw new NotFoundError();
    if (!sessionUser || Number(sessionUser.id) !== Number(user.id)) throw new ForbiddenError();
    const validationError = this.validateUsername(newUsername);
    if (validationError) throw new ValidationError(validationError);
    const now = new Date();
    const cutoffInterval = 30 * 24 * 60 * 60 * 1000; // 30 Days
    const cutoffDate = new Date(now.getTime() - cutoffInterval);
    const recentChanges = await kysely
      .selectFrom('usernamechange')
      .selectAll()
      .where('changed_for', '=', user.id)
      .where('changed_at', '>=', cutoffDate)
      .orderBy('changed_at', 'desc')
      .execute();
    if (recentChanges.length > 0) {
      const tryAgainOn = new Date(recentChanges[0].changed_at.getTime() + cutoffInterval);
      throw new RequestError('Username recently changed', { code: HttpStatusCode.TooManyRequests, data: tryAgainOn });
    }
    try {
      const result = await kysely.updateTable('user').set({ username: newUsername }).where('id', '=', user.id).executeTakeFirstOrThrow();
      await kysely
        .insertInto('usernamechange')
        .values({ changed_for: user.id, changed_from: oldUsername, changed_to: newUsername, changed_at: new Date() })
        .execute();
      return { numUpdatedRows: Number(result.numUpdatedRows) };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new ValidationError('Username already taken.');
      throw err;
    }
  }

  async putEmail(sessionUser: User | undefined, username: string, { email, password }): Promise<{ numUpdatedRows: number }> {
    const user = await this.getOneWithAuth({ 'user.username': username });
    if (!sessionUser || Number(sessionUser.id) !== Number(user.id)) throw new ForbiddenError();
    const isCorrectLogin = this.validatePassword(password, user.password, user.salt);
    if (!isCorrectLogin) throw new UnauthorizedError('Incorrect password');
    const result = await kysely
      .updateTable('user')
      .set({ email, verified: false })
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    return { numUpdatedRows: Number(result.numUpdatedRows) };
  }

  async putPassword(sessionUser: User | undefined, username: string, { oldPassword, newPassword }): Promise<{ numUpdatedRows: number }> {
    const user = await this.getOneWithAuth({ 'user.username': username });
    if (!sessionUser || Number(sessionUser.id) !== Number(user.id)) throw new ForbiddenError();
    const isCorrectLogin = this.validatePassword(oldPassword, user.password, user.salt);
    if (!isCorrectLogin) throw new UnauthorizedError('Incorrect password');
    const salt = utils.createRandom32String();
    const result = await kysely
      .updateTable('user')
      .set({ salt, password: utils.createHash(newPassword, salt) })
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    return { numUpdatedRows: Number(result.numUpdatedRows) };
  }

  /**
   * WARNING: THIS METHOD IS *UNSAFE* AND SHOULD *ONLY* BE CALLED BY AUTHORIZED ROUTES!
   * @param {number} user_id id of user to delete
   * @returns {Promise<[number, User?]>}
   */
  async doDeleteUser(userId): Promise<[number, User?]> {
    await withTransaction(async (trx) => {
      await trx.updateTable('comment').set({ body: null, author_id: null }).where('author_id', '=', userId).execute();
      await trx.updateTable('item').set({ author_id: null }).where('author_id', '=', userId).execute();
      await trx.updateTable('item').set({ last_updated_by: null }).where('last_updated_by', '=', userId).execute();
      await trx.updateTable('universe').set({ author_id: null }).where('author_id', '=', userId).execute();

      // Kysely doesn't support UPDATE-with-JOIN either
      await sql`
        UPDATE authoruniverse
        INNER JOIN (
          SELECT MIN(au1.id) AS id
          FROM authoruniverse AS au1
          INNER JOIN (
            SELECT universe_id, MAX(permission_level) AS max_perm
            FROM authoruniverse
            WHERE universe_id IN (
              SELECT universe_id FROM authoruniverse WHERE user_id = ${userId}
            ) AND user_id != ${userId} AND permission_level >= ${perms.ADMIN}
            GROUP BY universe_id
          ) au2 ON au1.universe_id = au2.universe_id AND au1.permission_level = au2.max_perm
          WHERE au1.permission_level < ${perms.OWNER}
          GROUP BY au1.universe_id
        ) AS to_promote ON authoruniverse.id = to_promote.id
        SET authoruniverse.permission_level = ${perms.OWNER}
      `.execute(trx);

      await trx.deleteFrom('session').where('user_id', '=', userId).execute();
      await trx.deleteFrom('user').where('id', '=', userId).execute();

      // Delete orphaned universes (universes with no other owner or admin)
      await trx
        .deleteFrom('universe')
        .where('id', 'not in', (eb) => eb
          .selectFrom('authoruniverse')
          .select('universe_id')
          .distinct()
          .where('permission_level', '>=', perms.ADMIN))
        .execute();
    });
    return [200];
  }

  async del(sessionUser: User | undefined, username: string, password: string): Promise<void> {
    if (!sessionUser) throw new UnauthorizedError();
    const user = await this.getOneWithAuth({ 'user.username': username });
    if (user) {
      if (sessionUser.id !== user.id) {
        throw new ForbiddenError('Can\'t delete user you\'re not logged in as!');
      }
      const isCorrectLogin = this.validatePassword(password, user.password, user.salt);
      if (!isCorrectLogin) {
        throw new ForbiddenError('Password incorrect!');
      }
      await kysely.insertInto('userdeleterequest').values({ user_id: user.id }).execute();
      await this.api.email.sendTemplateEmail(this.api.email.templates.DELETE, SITE_OWNER_EMAIL, { username });
      return;
    } else {
      throw new NotFoundError();
    }
  }

  async getDeleteRequest(user) {
    if (!user) return [401];

    const request = await kysely
      .selectFrom('userdeleterequest')
      .selectAll()
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    if (!request) return [404];

    return [200, request];
  }

  async prepareVerification(userId) {
    const verificationKey = utils.createRandom32String();

    await kysely.insertInto('userverification').values({ user_id: userId, verification_key: verificationKey }).execute();

    return verificationKey;
  }

  async verifyUser(verificationKey: string): Promise<number> {
    const record = await kysely
      .selectFrom('userverification')
      .select('user_id')
      .where('verification_key', '=', verificationKey)
      .executeTakeFirst();
    if (!record) throw new NotFoundError('No such verification key');
    const user = await this.getOne({ id: record.user_id });
    await this.put(user.id, user.id, { verified: true });
    await kysely.deleteFrom('userverification').where('user_id', '=', user.id).execute();

    logger.info(`User ${user.username} (${user.email}) verified!`);

    return user.id;
  }

  async preparePasswordReset(userId) {
    const resetKey = utils.createRandom32String();

    const now = new Date();
    const expiresIn = 7 * 24 * 60 * 60 * 1000;
    await kysely
      .insertInto('userpasswordreset')
      .values({ user_id: userId, reset_key: resetKey, expires_at: new Date(now.getTime() + expiresIn) })
      .execute();

    return resetKey;
  }

  async resetPassword(resetKey: string, newPassword: string): Promise<number> {
    const record = await kysely
      .selectFrom('userpasswordreset')
      .select('user_id')
      .where('reset_key', '=', resetKey)
      .where('expires_at', '>', sql<Date>`NOW()`)
      .executeTakeFirst();
    if (!record) throw new NotFoundError();
    const user = await this.getOne({ id: record.user_id });

    const salt = utils.createRandom32String();
    const newHashedPass = utils.createHash(newPassword, salt);
    await withTransaction(async (trx) => {
      await trx.updateTable('user').set({ salt, password: newHashedPass }).where('id', '=', user.id).execute();
      await trx.deleteFrom('session').where('user_id', '=', user.id).execute();
      await trx.deleteFrom('userpasswordreset').where('user_id', '=', user.id).execute();
    });

    logger.info(`Reset password for user ${user.username}.`);

    return user.id;
  }
}
