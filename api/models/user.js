const { executeQuery, parseData, withTransaction, perms } = require('../utils');
const utils = require('../../lib/hashUtils');
const logger = require('../../logger');
const { SITE_OWNER_EMAIL } = require('../../config');

let api;
function setApi(_api) {
  api = _api;
}

/**
   * returns a "safe" version of the user object with password data removed unless the includeAuth parameter is true
   * @param {*} options 
   * @param {boolean} includeAuth 
   * @returns {Promise<[status, data]>}
   */
async function getOne(options, includeAuth=false, includeNotifs=false) {
  try {
    if (!options || Object.keys(options).length === 0) throw 'options required for api.get.user';
    const parsedOptions = parseData(options);
    const queryString = `
      SELECT user.*, (ui.user_id IS NOT NULL) as hasPfp
      ${includeNotifs ? ', COUNT(notif.id) as notifications' : ''}
      FROM user
      LEFT JOIN userimage AS ui ON user.id = ui.user_id
      ${includeNotifs ? 'LEFT JOIN sentnotification AS notif ON user.id = notif.user_id AND NOT notif.is_read' : ''}
      WHERE ${parsedOptions.strings.join(' AND ')}
      GROUP BY user.id
      LIMIT 1;
    `;
    const user = (await executeQuery(queryString, parsedOptions.values))[0];
    if (!user) return [404];
    if (!includeAuth) {
      delete user.password;
      delete user.salt;
    }
    return [200, user];
  } catch (err) {
    logger.error(err);
    return [500];
  }
}

/**
 * 
 * @param {*} options
 * @returns {Promise<[status, data]>}
 */
async function getMany(options, includeEmail=false) {
  try {
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
    const users = await executeQuery(queryString, parsedOptions.values);
    return [200, users];
  } catch (err) {
    logger.error(err);
    return [500];
  }
}

async function getByUniverseShortname(user, shortname) {

  const [code, universe] = await api.universe.getOne(user, { shortname });
  if (!universe) return [code];

  try {
    const queryString = `
      SELECT 
        user.id,
        user.username,
        user.created_at,
        user.updated_at,
        user.email,
        COUNT(item.id) AS items_authored,
        (ui.user_id IS NOT NULL) as hasPfp
      FROM user
      INNER JOIN authoruniverse AS au ON au.user_id = user.id
      LEFT JOIN item ON item.universe_id = au.universe_id AND item.author_id = user.id
      LEFT JOIN userimage AS ui ON user.id = ui.user_id
      WHERE au.universe_id = ?
      GROUP BY user.id;
    `;
    const users = await executeQuery(queryString, [universe.id]);
    return [200, users];
  } catch (err) {
    logger.error(err);
    return [500];
  }
}

/**
 * 
 * @param {*} userData 
 * @returns 
 */
function post({ username, email, password, hp }) {
  const salt = utils.createRandom32String();

  if (!username) throw new Error('username is required');
  if (!email) throw new Error('email is required');
  if (!password) throw new Error('empty password not allowed');

  const validationError = validateUsername(username);
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
  return executeQuery(queryString, [
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
function validatePassword(attempted, password, salt) {
  return utils.compareHash(attempted, password, salt);
}

function validateUsername(username) {
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

async function put(user_id, userIDToPut, { updated_at, verified }) {
  const changes = { updated_at, verified };

  if (Number(user_id) !== Number(userIDToPut)) return [403];

  try {
    const keys = Object.keys(changes).filter(key => changes[key] !== undefined);
    const values = keys.map(key => changes[key]);
    const queryString = `
      UPDATE user
      SET
        ${keys.map(key => `${key} = ?`).join(', ')}
      WHERE id = ?;
    `;
    return [200, await executeQuery(queryString, [...values, userIDToPut])];
  } catch (err) {
    logger.error(err);
    return [500];
  }
}

async function putUsername(sessionUser, oldUsername, newUsername) {
  const [code, user] = await getOne({ 'user.username': oldUsername });
  if (!user) return [code];
  if (Number(sessionUser.id) !== Number(user.id)) return [403];

  const validationError = validateUsername(newUsername);
  if (validationError) return [400, validationError];

  const now = new Date();
  const cutoffInterval = 30 * 24 * 60 * 60 * 1000; // 30 Days
  const cutoffDate = new Date(now.getTime() - cutoffInterval);
  const recentChanges = await executeQuery(`
    SELECT *
    FROM usernamechange
    WHERE changed_for = ? AND changed_at >= ?
    ORDER BY changed_at DESC;
  `, [user.id, cutoffDate]);
  if (recentChanges.length > 0) return [429, new Date(recentChanges[0].changed_at.getTime() + cutoffInterval)];

  try {
    const queryString = `
      UPDATE user
      SET
        username = ?
      WHERE id = ?;
    `;
    const data = await executeQuery(queryString, [newUsername, user.id]);
    await executeQuery(`
      INSERT INTO usernamechange (
        changed_for,
        changed_from,
        changed_to,
        changed_at
      ) VALUES (?, ?, ?, ?)
    `, [user.id, oldUsername, newUsername, new Date()]);
    return [200, data];
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return [400, 'Username already taken.'];
    logger.error(err);
    return [500];
  }
}

async function putPassword(sessionUser, username, { oldPassword, newPassword }) {
  const [code, user] = await getOne({ 'user.username': username }, true);
  if (!user) return [code];
  if (Number(sessionUser.id) !== Number(user.id)) return [403];

  const isCorrectLogin = validatePassword(oldPassword, user.password, user.salt);
  if (!isCorrectLogin) return [401];

  const salt = utils.createRandom32String();

  try {
    const data = await executeQuery(`
      UPDATE user
      SET
        salt = ?,
        password = ?
      WHERE id = ?
    `, [salt, utils.createHash(newPassword, salt), user.id]);
    return [200, data];
  } catch (err) {
    logger.error(err);
    return [500];
  }
}

/**
 * WARNING: THIS METHOD IS *UNSAFE* AND SHOULD *ONLY* BE CALLED BY AUTHORIZED ROUTES!
 * @param {number} user_id id of user to delete 
 * @returns {Promise<[status, data]>}
 */
async function doDeleteUser(userId) {
  try {
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
  } catch (err) {
    logger.error(err);
    return [500];
  }
}

async function del(sessionUser, username, password) {
  if (!sessionUser) return [401];
  try {  
    const [status, user] = await getOne({ 'user.username': username }, true);
    if (user) {
      if (sessionUser.id !== user.id) {
        return [403, 'Can\'t delete user you\'re not logged in as!'];
      }
      const isCorrectLogin = validatePassword(password, user.password, user.salt);
      if (!isCorrectLogin) {
        return [403, 'Password incorrect!'];
      }
      await executeQuery('INSERT INTO userdeleterequest (user_id) VALUES (?);', [user.id]);
      await api.email.sendTemplateEmail(api.email.templates.DELETE, SITE_OWNER_EMAIL, { username });
      return [200];
    } else {
      return [status];
    }
  } catch (err) {
    logger.error(err);
    return [500];
  }
}

async function getDeleteRequest(user) {
  if (!user) return [401];
  
  try {
    const request = (await executeQuery(
      'SELECT * FROM userdeleterequest WHERE user_id = ?',
      [user.id],
    ))[0];
    if (!request) return [404];

    return [200, request];
  } catch (err) {
    logger.error(err);
    return [500];
  }
}

async function prepareVerification(userId) {
  const verificationKey = utils.createRandom32String();

  await executeQuery('INSERT INTO userverification (user_id, verification_key) VALUES (?, ?);', [userId, verificationKey]);

  return verificationKey;
}

async function verifyUser(verificationKey) {
  const records = await executeQuery('SELECT user_id FROM userverification WHERE verification_key = ?;', [verificationKey]);
  if (records.length === 0) return [404];
  const [code, user] = await getOne({ id: records[0].user_id });
  if (!user) return [code];
  await put(user.id, user.id, { verified: true });
  await executeQuery('DELETE FROM userverification WHERE user_id = ?;', [user.id]);

  logger.info(`User ${user.username} (${user.email}) verified!`);

  return [200, user.id];
}

async function preparePasswordReset(userId) {
  const resetKey = utils.createRandom32String();

  const now = new Date();
  const expiresIn = 7 * 24 * 60 * 60 * 1000;
  await executeQuery('INSERT INTO userpasswordreset (user_id, reset_key, expires_at) VALUES (?, ?, ?);', [userId, resetKey, new Date(now.getTime() + expiresIn)]);

  return resetKey;
}

async function resetPassword(resetKey, newPassword) {
  const records = await executeQuery('SELECT user_id FROM userpasswordreset WHERE reset_key = ? AND expires_at > NOW();', [resetKey]);
  if (records.length === 0) return [404];
  const [code, user] = await getOne({ id: records[0].user_id });
  if (!user) return [code];

  const salt = utils.createRandom32String();
  const newHashedPass = utils.createHash(newPassword, salt);
  await withTransaction(async (conn) => {
    await conn.execute('UPDATE user SET salt = ?, password = ? WHERE id = ?;', [salt, newHashedPass, user.id]);
    await conn.execute('DELETE FROM session WHERE user_id = ?;', [user.id]);
    await conn.execute('DELETE FROM userpasswordreset WHERE user_id = ?;', [user.id]);
  });

  logger.info(`Reset password for user ${user.username}.`);

  return [200, user.id];
}

const image = (function() {
  async function getByUsername(username) {
    try {
      const [code, user] = await getOne({ 'user.username': username });
      if (!user) return [code];
      let queryString = `
        SELECT 
          user_id, name, mimetype, data
        FROM userimage
        WHERE user_id = ?;
      `;
      const image = (await executeQuery(queryString, [user.id]))[0];
      return [200, image];
    } catch (err) {
      logger.error(err);
      return [500];
    }
  }

  async function post(sessionUser, file, username) {
    if (!file) return [400];
    if (!sessionUser) return [401];
    if (sessionUser.username !== username) return [403];

    const { originalname, buffer, mimetype } = file;
    const [code, user] = await getOne({ 'user.username': username });
    if (!user) return [code];

    try {
      let data;
      await withTransaction(async (conn) => {
        await conn.execute('DELETE FROM userimage WHERE user_id = ?', [user.id]);
        const queryString = `INSERT INTO userimage (user_id, name, mimetype, data) VALUES (?, ?, ?, ?);`;
        [ data ] = await conn.execute(queryString, [ user.id, originalname.substring(0, 64), mimetype, buffer ]);
      });
      return [201, data];
    } catch (err) {
      logger.error(err);
      return [500];
    }

  }

  async function del(sessionUser, username) {
    try {
      if (!sessionUser) return [401];
      if (sessionUser.username !== username) return [403];
      
      const [code, user] = await getOne({ 'user.username': username });
      if (!user) return [code];

      return [200, await executeQuery(`DELETE FROM userimage WHERE user_id = ?;`, [user.id])];
    } catch (err) {
      logger.error(err);
      return [500];
    }
  }

  return {
    getByUsername,
    post,
    del,
  };
})();

module.exports = {
  setApi,
  image,
  getOne,
  getMany,
  getByUniverseShortname,
  post,
  validatePassword,
  validateUsername,
  put,
  putUsername,
  putPassword,
  del,
  doDeleteUser,
  getDeleteRequest,
  prepareVerification,
  verifyUser,
  preparePasswordReset,
  resetPassword,
};
