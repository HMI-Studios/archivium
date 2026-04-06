import { executeQuery, parseData, withTransaction, perms, plans } from '../utils';
import utils from '../../lib/hashUtils';
import logger from '../../logger';
import { SITE_OWNER_EMAIL } from '../../config';
import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { API } from '..';
import { RequestError, ModelError, ValidationError, UnauthorizedError, ForbiddenError, NotFoundError } from '../../errors';
import { HttpStatusCode } from 'axios';
import { Theme, ThemeName } from '../../themes';

export type UserSponsoredUniverses = { tier: number, universes: string[], universe_shorts: string[] }[];

export type UserImage = {
  user_id: number,
  name: string,
  mimetype: string,
  data: Buffer,
};

export type User = {
  id: number,
  username: string,
  email?: string,
  pfpUrl?: string,
  password?: string,
  salt?: string,
  created_at: Date,
  updated_at: Date,
  verified: boolean,
  suspect: boolean,
  email_notifications: boolean,
  preferred_theme: ThemeName | null,
  custom_theme: Theme | null,
  isContact?: boolean,
  hasPfp?: boolean,
  plan?: plans,
  notifications?: number,
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
    let queryString = `
      SELECT 
        ui.user_id, image.name, image.mimetype, image.data
      FROM userimage AS ui
      INNER JOIN image ON image.id = ui.image_id
      WHERE ui.user_id = ?;
    `;
    const image = (await executeQuery(queryString, [user.id]))[0] as UserImage | undefined;
    return image;
  }

  async post(sessionUser: User | undefined, file: Express.Multer.File | undefined, username: string): Promise<ResultSetHeader> {
    if (!file) throw new ValidationError('No file provided');
    if (!sessionUser) throw new UnauthorizedError();
    if (sessionUser.username !== username) throw new ForbiddenError();

    const { originalname, buffer, mimetype } = file;
    const user = await this.user.getOne({ 'user.username': username });

    let data!: ResultSetHeader;
    await withTransaction(async (conn: PoolConnection) => {
      await conn.execute(`
        DELETE image FROM image
        INNER JOIN userimage AS ui ON ui.image_id = image.id
        WHERE ui.user_id = ?
      `, [user.id]);

      [data] = await conn.execute<ResultSetHeader>(
        `INSERT INTO image (name, mimetype, data) VALUES (?, ?, ?)`,
        [originalname.substring(0, 64), mimetype, buffer],
      );

      await conn.execute<ResultSetHeader>(
        `INSERT INTO userimage (user_id, image_id) VALUES (?, ?)`,
        [user.id, data.insertId],
      );
    });
    return data;
  }

  async del(sessionUser: User | undefined, username: string): Promise<ResultSetHeader> {
    if (!sessionUser) throw new UnauthorizedError();
    if (sessionUser.username !== username) throw new ForbiddenError();
    const user = await this.user.getOne({ 'user.username': username });
    return await executeQuery<ResultSetHeader>(`
      DELETE image FROM image
      INNER JOIN userimage AS ui ON ui.image_id = image.id
      WHERE ui.user_id = ?
    `, [user.id]);
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

  /**
   * returns a "safe" version of the user object with password data removed unless the includeAuth parameter is true
   * @param {*} options
   * @param {boolean} includeAuth
   * @returns {Promise<User>}
   */
  async getOne(options: any, includeAuth: boolean=false, includeNotifs=false): Promise<User> {
    if (!options || Object.keys(options).length === 0) throw new ValidationError('options required for api.get.user');
    const parsedOptions = parseData(options);
    const queryString = `
      SELECT
        user.*,
        (ui.user_id IS NOT NULL) AS hasPfp,
        up.plan
        ${includeNotifs ? ', COUNT(notif.id) AS notifications' : ''}
      FROM user
      LEFT JOIN userimage AS ui ON user.id = ui.user_id
      LEFT JOIN userplan AS up ON user.id = up.user_id
      ${includeNotifs ? 'LEFT JOIN sentnotification AS notif ON user.id = notif.user_id AND NOT notif.is_read' : ''}
      WHERE ${parsedOptions.strings.join(' AND ')}
      GROUP BY user.id, up.plan
      LIMIT 1;
    `;
    const user = (await executeQuery(queryString, parsedOptions.values))[0] as User;
    if (!user) throw new NotFoundError();
    if (!includeAuth) {
      delete user.password;
      delete user.salt;
    }
    return user;
  }

  /**
   * 
   * @param {*} options
   * @returns {Promise<User[]>}
   */
  async getMany(options: any=null, includeEmail=false): Promise<User[]> {
    const parsedOptions = parseData(options);
    let queryString;
    if (options) queryString = `
      SELECT 
        user.id, user.username, user.created_at, user.updated_at, ${includeEmail ? 'user.email, ' : ''}
        (ui.user_id IS NOT NULL) as hasPfp
      FROM user
      LEFT JOIN userimage AS ui ON user.id = ui.user_id
      WHERE ${parsedOptions.strings.join(' AND ')};
    `;
    else queryString = `SELECT id, username, created_at, updated_at ${includeEmail ? ', email' : ''} FROM user;`;
    const users = await executeQuery(queryString, parsedOptions.values) as User[];
    return users;
  }

  async getByUniverseShortname(user: User | undefined, shortname: string): Promise<(User & { items_authored: number })[]> {
    const universe = await this.api.universe.getOne(user, { shortname });
    const queryString = `
      SELECT 
        user.id,
        user.username,
        user.created_at,
        user.updated_at,
        user.email,
        userplan.plan,
        COUNT(item.id) AS items_authored,
        (ui.user_id IS NOT NULL) as hasPfp
      FROM user
      INNER JOIN authoruniverse AS au ON au.user_id = user.id
      LEFT JOIN item ON item.universe_id = au.universe_id AND item.author_id = user.id
      LEFT JOIN userimage AS ui ON user.id = ui.user_id
      LEFT JOIN userplan ON user.id = userplan.user_id
      WHERE au.universe_id = ?
      GROUP BY user.id, userplan.plan;
    `;
    const users = await executeQuery(queryString, [universe.id]) as (User & { items_authored: number })[];
    return users;
  }

  async getSponsoredUniverses(user: User | undefined): Promise<UserSponsoredUniverses> {
    if (!user) throw new ValidationError('User required');
    const queryString = `
      SELECT
        usu.tier,
        JSON_ARRAYAGG(universe.title) AS universes,
        JSON_ARRAYAGG(universe.shortname) AS universe_shorts
      FROM usersponsoreduniverse AS usu
      INNER JOIN universe ON usu.universe_id = universe.id
      WHERE usu.user_id = ?
      GROUP BY usu.tier;
    `;
    const universes = await executeQuery(queryString, [user.id]) as UserSponsoredUniverses;
    return universes;
  }

  post({ username, email, password, hp }: any) {
    const salt = utils.createRandom32String();

    if (!username) throw new Error('username is required');
    if (!email) throw new Error('email is required');
    if (!password) throw new Error('empty password not allowed');

    const validationError = this.validateUsername(username);
    if (validationError) throw new Error(validationError);

    const suspect = hp !== '';

    const queryString = `
      INSERT INTO user (
        username,
        email,
        salt,
        password,
        created_at,
        updated_at,
        suspect
      ) VALUES (?, ?, ?, ?, ?, ?, ?);
    `;
    return executeQuery<ResultSetHeader>(queryString, [
      username,
      email,
      salt,
      utils.createHash(password, salt),
      new Date(),
      new Date(),
      suspect
    ]);
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
    const changes = { updated_at, verified };

    if (Number(user_id) !== Number(userIDToPut)) return [403];

    const keys = Object.keys(changes).filter(key => changes[key] !== undefined);
    const values = keys.map(key => changes[key]);
    const queryString = `
      UPDATE user
      SET
        ${keys.map(key => `${key} = ?`).join(', ')}
      WHERE id = ?;
    `;
    return [200, await executeQuery(queryString, [...values, userIDToPut])];
  }

  async putPreferences(sessionUser: User | undefined, username: string, body: { preferred_theme: string, custom_theme: Theme }): Promise<ResultSetHeader> {
    if (!sessionUser) throw new UnauthorizedError();
    const { preferred_theme, custom_theme } = body;
    const user = await this.getOne({ 'user.username': username }, true);
    if (Number(sessionUser.id) !== Number(user.id)) throw new ForbiddenError();
    const changes = { preferred_theme, custom_theme };
    const keys = Object.keys(changes).filter(key => changes[key] !== undefined);
    if (keys.length === 0) throw new ValidationError('No changes provided');
    const values = keys.map(key => changes[key]);
    const queryString = `
      UPDATE user
      SET
        ${keys.map(key => `${key} = ?`).join(', ')}
      WHERE id = ?;
    `;
    return await executeQuery<ResultSetHeader>(queryString, [...values, user.id]);
  }

  async putUsername(sessionUser: User | undefined, oldUsername: string, newUsername: string): Promise<Date | ResultSetHeader | string> {
    const user = await this.getOne({ 'user.username': oldUsername });
    if (!user) throw new NotFoundError();
    if (!sessionUser || Number(sessionUser.id) !== Number(user.id)) throw new ForbiddenError();
    const validationError = this.validateUsername(newUsername);
    if (validationError) throw new ValidationError(validationError);
    const now = new Date();
    const cutoffInterval = 30 * 24 * 60 * 60 * 1000; // 30 Days
    const cutoffDate = new Date(now.getTime() - cutoffInterval);
    const recentChanges = await executeQuery(`
      SELECT *
      FROM usernamechange
      WHERE changed_for = ? AND changed_at >= ?
      ORDER BY changed_at DESC;
    `, [user.id, cutoffDate]);
    if (recentChanges.length > 0) {
      const tryAgainOn = new Date(recentChanges[0].changed_at.getTime() + cutoffInterval);
      throw new RequestError('Username recently changed', { code: HttpStatusCode.TooManyRequests, data: tryAgainOn });
    }
    try {
      const queryString = `
        UPDATE user
        SET
          username = ?
        WHERE id = ?;
      `;
      const data = await executeQuery<ResultSetHeader>(queryString, [newUsername, user.id]);
      await executeQuery(`
        INSERT INTO usernamechange (
          changed_for,
          changed_from,
          changed_to,
          changed_at
        ) VALUES (?, ?, ?, ?)
      `, [user.id, oldUsername, newUsername, new Date()]);
      return data;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new ValidationError('Username already taken.');
      throw err;
    }
  }

  async putEmail(sessionUser: User | undefined, username: string, { email, password }): Promise<ResultSetHeader> {
    const user = await this.getOne({ 'user.username': username }, true);
    if (!sessionUser || Number(sessionUser.id) !== Number(user.id)) throw new ForbiddenError();
    const isCorrectLogin = this.validatePassword(password, user.password, user.salt);
    if (!isCorrectLogin) throw new UnauthorizedError('Incorrect password');
    const data = await executeQuery<ResultSetHeader>(`
      UPDATE user
      SET
        email = ?,
        verified = ?
      WHERE id = ?
    `, [email, false, user.id]);
    return data;
  }

  async putPassword(sessionUser: User | undefined, username: string, { oldPassword, newPassword }): Promise<ResultSetHeader> {
    const user = await this.getOne({ 'user.username': username }, true);
    if (!sessionUser || Number(sessionUser.id) !== Number(user.id)) throw new ForbiddenError();
    const isCorrectLogin = this.validatePassword(oldPassword, user.password, user.salt);
    if (!isCorrectLogin) throw new UnauthorizedError('Incorrect password');
    const salt = utils.createRandom32String();
    const data = await executeQuery<ResultSetHeader>(`
      UPDATE user
      SET
        salt = ?,
        password = ?
      WHERE id = ?
    `, [salt, utils.createHash(newPassword, salt), user.id]);
    return data;
  }

  /**
   * WARNING: THIS METHOD IS *UNSAFE* AND SHOULD *ONLY* BE CALLED BY AUTHORIZED ROUTES!
   * @param {number} user_id id of user to delete 
   * @returns {Promise<[number, User?]>}
   */
  async doDeleteUser(userId): Promise<[number, User?]> {
    await withTransaction(async (conn) => {
      await conn.execute('UPDATE comment SET body = NULL, author_id = NULL WHERE author_id = ?', [userId]);
      await conn.execute('UPDATE item SET author_id = NULL WHERE author_id = ?', [userId]);
      await conn.execute('UPDATE item SET last_updated_by = NULL WHERE last_updated_by = ?', [userId]);
      await conn.execute('UPDATE universe SET author_id = NULL WHERE author_id = ?', [userId]);

      // Promote highest-ranking user of abandoned universes with at least one other admin
      await conn.execute(`
        UPDATE authoruniverse
        INNER JOIN (
          SELECT MIN(au1.id) AS id
          FROM authoruniverse AS au1
          INNER JOIN (
            SELECT universe_id, MAX(permission_level) AS max_perm
            FROM authoruniverse
            WHERE universe_id IN (
              SELECT universe_id FROM authoruniverse WHERE user_id = ?
            ) AND user_id != ? AND permission_level >= ?
            GROUP BY universe_id
          ) au2 ON au1.universe_id = au2.universe_id AND au1.permission_level = au2.max_perm
          WHERE au1.permission_level < ?
          GROUP BY au1.universe_id
        ) AS to_promote ON authoruniverse.id = to_promote.id
        SET authoruniverse.permission_level = ?
      `, [userId, userId, perms.ADMIN, perms.OWNER, perms.OWNER]);

      await conn.execute('DELETE FROM session WHERE user_id = ?', [userId]);
      await conn.execute('DELETE FROM user WHERE id = ?', [userId]);

      // Delete orphaned universes (universes with no other owner or admin)
      await conn.execute(`
        DELETE FROM universe
        WHERE id NOT IN (
          SELECT DISTINCT universe_id FROM authoruniverse WHERE permission_level >= ?
        )
      `, [perms.ADMIN]);
    });
    return [200];
  }

  async del(sessionUser, username, password): Promise<void> {
    if (!sessionUser) throw new UnauthorizedError();
    const user = await this.getOne({ 'user.username': username }, true);
    if (user) {
      if (sessionUser.id !== user.id) {
        throw new ForbiddenError('Can\'t delete user you\'re not logged in as!');
      }
      const isCorrectLogin = this.validatePassword(password, user.password, user.salt);
      if (!isCorrectLogin) {
        throw new ForbiddenError('Password incorrect!');
      }
      await executeQuery('INSERT INTO userdeleterequest (user_id) VALUES (?);', [user.id]);
      await this.api.email.sendTemplateEmail(this.api.email.templates.DELETE, SITE_OWNER_EMAIL, { username });
      return;
    } else {
      throw new NotFoundError();
    }
  }

  async getDeleteRequest(user) {
    if (!user) return [401];
    
    const request = (await executeQuery(
      'SELECT * FROM userdeleterequest WHERE user_id = ?',
      [user.id],
    ))[0];
    if (!request) return [404];

    return [200, request];
  }

  async prepareVerification(userId) {
    const verificationKey = utils.createRandom32String();

    await executeQuery('INSERT INTO userverification (user_id, verification_key) VALUES (?, ?);', [userId, verificationKey]);

    return verificationKey;
  }

  async verifyUser(verificationKey: string): Promise<number> {
    const records = await executeQuery('SELECT user_id FROM userverification WHERE verification_key = ?;', [verificationKey]);
    if (records.length === 0) throw new NotFoundError('No such verification key');
    const user = await this.getOne({ id: records[0].user_id });
    await this.put(user.id, user.id, { verified: true });
    await executeQuery('DELETE FROM userverification WHERE user_id = ?;', [user.id]);

    logger.info(`User ${user.username} (${user.email}) verified!`);

    return user.id;
  }

  async preparePasswordReset(userId) {
    const resetKey = utils.createRandom32String();

    const now = new Date();
    const expiresIn = 7 * 24 * 60 * 60 * 1000;
    await executeQuery('INSERT INTO userpasswordreset (user_id, reset_key, expires_at) VALUES (?, ?, ?);', [userId, resetKey, new Date(now.getTime() + expiresIn)]);

    return resetKey;
  }

  async resetPassword(resetKey: string, newPassword: string): Promise<number> {
    const records = await executeQuery('SELECT user_id FROM userpasswordreset WHERE reset_key = ? AND expires_at > NOW();', [resetKey]);
    if (records.length === 0) throw new NotFoundError();
    const user = await this.getOne({ id: records[0].user_id });

    const salt = utils.createRandom32String();
    const newHashedPass = utils.createHash(newPassword, salt);
    await withTransaction(async (conn) => {
      await conn.execute('UPDATE user SET salt = ?, password = ? WHERE id = ?;', [salt, newHashedPass, user.id]);
      await conn.execute('DELETE FROM session WHERE user_id = ?;', [user.id]);
      await conn.execute('DELETE FROM userpasswordreset WHERE user_id = ?;', [user.id]);
    });

    logger.info(`Reset password for user ${user.username}.`);

    return user.id;
  }
}
