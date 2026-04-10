"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UniverseAPI = void 0;
const errors_1 = require("../../errors");
const utils_1 = require("../utils");
const validateShortname = (shortname, reservedShortnames = ['create', 'news', '_home', '_public']) => {
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
    [utils_1.perms.READ]: 'read',
    [utils_1.perms.COMMENT]: 'comment',
    [utils_1.perms.WRITE]: 'write',
    [utils_1.perms.ADMIN]: 'admin',
    [utils_1.perms.OWNER]: 'owner',
};
class UniverseAPI {
    api;
    validateShortname = validateShortname;
    constructor(api) {
        this.api = api;
    }
    async getOne(user, conditions, permissionLevel = utils_1.perms.READ) {
        if (!conditions)
            throw new errors_1.ValidationError('Conditions are required.');
        const parsedConditions = (0, utils_1.parseData)(conditions);
        const data = await this.getMany(user, parsedConditions, permissionLevel);
        const universe = data[0];
        if (!universe) {
            const exists = (await (0, utils_1.executeQuery)(`SELECT 1 FROM universe WHERE ${parsedConditions.strings.join(' AND ')}`, parsedConditions.values)).length > 0;
            if (exists) {
                if (user)
                    throw new errors_1.ForbiddenError();
                else
                    throw new errors_1.UnauthorizedError();
            }
            else {
                throw new errors_1.NotFoundError();
            }
        }
        return universe;
    }
    async getMany(user, conditions = null, permissionLevel = utils_1.perms.READ, options = {}) {
        if (options.sort && !options.forceSort) {
            const validSorts = { 'title': true, 'created_at': true, 'updated_at': true };
            if (!validSorts[options.sort]) {
                delete options.sort;
            }
        }
        if (!user && permissionLevel > utils_1.perms.READ)
            throw new errors_1.ValidationError('User is required to access at above read-only permissions.');
        const readOnlyQueryString = permissionLevel > utils_1.perms.READ ? '' : `universe.is_public = 1`;
        const usrQueryString = user ? `(au_filter.user_id = ${user.id} AND au_filter.permission_level >= ${permissionLevel})` : '';
        const permsQueryString = `${readOnlyQueryString}${(readOnlyQueryString && usrQueryString) ? ' OR ' : ''}${usrQueryString}`;
        const conditionString = conditions ? `WHERE ${conditions.strings.join(' AND ')}` : '';
        const queryString = `
      SELECT 
        universe.*,
        JSON_OBJECTAGG(author.id, author.username) AS authors,
        JSON_OBJECTAGG(author.id, au.permission_level) AS author_permissions,
        owner.username AS owner,
        JSON_REMOVE(JSON_OBJECTAGG(
          IFNULL(fu.user_id, 'null__'),
          fu.is_following
        ), '$.null__') AS followers,
        usu.tier AS tier,
        usu.user_id AS sponsoring_user
      FROM universe
      INNER JOIN authoruniverse AS au_filter
        ON universe.id = au_filter.universe_id AND (
          ${permsQueryString}
        )
      LEFT JOIN authoruniverse AS au ON universe.id = au.universe_id
      LEFT JOIN user AS author ON author.id = au.user_id
      LEFT JOIN followeruniverse AS fu ON universe.id = fu.universe_id
      LEFT JOIN user AS owner ON universe.author_id = owner.id
      LEFT JOIN usersponsoreduniverse AS usu ON universe.id = usu.universe_id
      ${conditionString}
      GROUP BY universe.id
      ORDER BY ${options.sort ? `${options.sort} ${options.sortDesc ? 'DESC' : 'ASC'}` : 'updated_at DESC'}`;
        const data = await (0, utils_1.executeQuery)(queryString, conditions && conditions.values);
        return data;
    }
    getManyByAuthorId(user, authorId, permissionLevel = utils_1.perms.WRITE) {
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
    getManyByAuthorName(user, authorName) {
        return this.getMany(user, {
            strings: [`
        EXISTS (
          SELECT 1
          FROM authoruniverse as au_check
          WHERE au_check.universe_id = universe.id
          AND (au_check.username = ? AND au_check.permission_level >= ?)
        )
      `], values: [
                authorName,
                utils_1.perms.READ,
            ]
        });
    }
    async getEventsByUniverseShortname(user, shortname, permissionsRequired = utils_1.perms.READ) {
        const universe = await this.getOne(user, { 'universe.shortname': shortname }, permissionsRequired);
        const queryString = `
      SELECT
        itemevent.event_title, itemevent.abstime,
        item.shortname AS src_shortname, item.title AS src_title, item.id AS src_id
      FROM itemevent
      INNER JOIN item on item.id = itemevent.item_id
      WHERE item.universe_id = ?
    `;
        return await (0, utils_1.executeQuery)(queryString, [universe.id]);
    }
    // Does not throw if universe has no body..
    async getPublicBodyByShortname(shortname) {
        const queryString = 'SELECT id, obj_data FROM universe WHERE shortname = ?';
        const universe = (await (0, utils_1.executeQuery)(queryString, [shortname]))[0];
        if (!universe)
            throw new errors_1.NotFoundError();
        const publicPageEnabled = universe.obj_data.publicPage;
        if (!publicPageEnabled)
            return;
        const itemQueryString = `SELECT obj_data FROM item WHERE universe_id = ? AND shortname = '_public'`;
        const item = (await (0, utils_1.executeQuery)(itemQueryString, [universe.id]))[0];
        if (!item)
            throw new errors_1.NotFoundError();
        const publicBody = item.obj_data.body;
        if (!publicBody)
            return;
        return publicBody;
    }
    async getTotalStoredByShortname(shortname) {
        const queryString = `
      SELECT SUM(OCTET_LENGTH(image.data)) AS size
      FROM universe
      INNER JOIN item ON item.universe_id = universe.id
      INNER JOIN itemimage ON itemimage.item_id = item.id
      INNER JOIN image ON image.id = itemimage.image_id
      WHERE universe.shortname = ?
      GROUP BY universe.title
    `;
        const rows = await (0, utils_1.executeQuery)(queryString, [shortname]);
        if (!rows)
            throw new errors_1.NotFoundError();
        return Number(rows[0]?.size);
    }
    async post(user, body) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        try {
            const { title, shortname, is_public, discussion_enabled, discussion_open, obj_data } = body;
            const shortnameError = this.validateShortname(shortname);
            if (shortnameError)
                throw new errors_1.ValidationError(shortnameError);
            if (!title)
                throw new errors_1.ValidationError('Title is required.');
            const queryString1 = `
        INSERT INTO universe (
          title,
          shortname,
          author_id,
          is_public,
          discussion_enabled,
          discussion_open,
          obj_data,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
      `;
            const data = await (0, utils_1.executeQuery)(queryString1, [
                title,
                shortname,
                user.id,
                is_public,
                discussion_enabled,
                discussion_open,
                obj_data,
                new Date(),
                new Date(),
            ]);
            const queryString2 = `INSERT INTO authoruniverse (universe_id, user_id, permission_level) VALUES (?, ?, ?)`;
            return [data, await (0, utils_1.executeQuery)(queryString2, [data.insertId, user.id, utils_1.perms.OWNER])];
        }
        catch (err) {
            if (err.code === 'ER_DUP_ENTRY')
                throw new errors_1.ValidationError('Universe shortname must be unique.');
            if (err.code === 'ER_BAD_NULL_ERROR')
                throw new errors_1.ValidationError('Missing parameters.');
            throw err;
        }
    }
    async putUpdatedAtWithTransaction(conn, universeId, updatedAt) {
        await conn.execute('UPDATE universe SET updated_at = ? WHERE id = ?', [updatedAt, universeId]);
    }
    async put(user, universeShortname, changes) {
        const { title, shortname, is_public, discussion_enabled, discussion_open, obj_data } = changes;
        if (!title)
            throw new errors_1.ValidationError('Title is required.');
        const universe = await this.getOne(user, { shortname: universeShortname }, utils_1.perms.WRITE);
        if (shortname !== null && shortname !== undefined && shortname !== universe.shortname) {
            // The item shortname has changed, we need to update all links to it to reflect this
            const shortnameError = this.validateShortname(shortname);
            if (shortnameError)
                throw new errors_1.ValidationError(shortnameError);
            await (0, utils_1.executeQuery)('UPDATE itemlink SET to_universe_short = ? WHERE to_universe_short = ?', [shortname, universe.shortname]);
        }
        const queryString = `
      UPDATE universe
      SET
        title = ?,
        shortname = ?,
        is_public = ?,
        discussion_enabled = ?,
        discussion_open = ?,
        obj_data = ?,
        updated_at = ?
      WHERE id = ?
    `;
        await (0, utils_1.executeQuery)(queryString, [title, shortname ?? universe.shortname, is_public, discussion_enabled, discussion_open, obj_data, new Date(), universe.id]);
        return universe.id;
    }
    async putPermissions(user, shortname, targetUser, permission_level) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        // If we have a pending invite to this universe for the same permission level, use the admin who invited us to assign the new permission level.
        const accessInvite = await this.getUserAccessRequestIfExists(user, shortname);
        const validInvite = accessInvite?.is_invite && accessInvite.permission_level === permission_level && user.id === targetUser.id;
        const invitingAdmin = validInvite && await this.api.user.getOne({ 'user.id': accessInvite.inviter_id });
        const universe = await this.getOne(invitingAdmin || user, { shortname }, permission_level === utils_1.perms.OWNER ? utils_1.perms.OWNER : Math.max(utils_1.perms.ADMIN, permission_level + 1));
        if (universe.author_permissions[targetUser.id] > universe.author_permissions[user.id])
            throw new errors_1.ForbiddenError();
        if (universe.author_permissions[targetUser.id] === utils_1.perms.OWNER && permission_level < utils_1.perms.OWNER) {
            let ownerWouldStillExist = false;
            for (const userID in universe.author_permissions) {
                if (Number(userID) !== Number(targetUser.id) && universe.author_permissions[userID] === utils_1.perms.OWNER) {
                    ownerWouldStillExist = true;
                    break;
                }
            }
            if (!ownerWouldStillExist)
                throw new errors_1.ValidationError('Cannot remove the last owner.');
        }
        let query;
        if (targetUser.id in universe.author_permissions) {
            if (permission_level === utils_1.perms.NONE) {
                query = (0, utils_1.executeQuery)('DELETE FROM authoruniverse WHERE universe_id = ? AND user_id = ?', [universe.id, targetUser.id]);
            }
            else {
                query = (0, utils_1.executeQuery)(`
          UPDATE authoruniverse 
          SET permission_level = ? 
          WHERE user_id = ? AND universe_id = ?`, [permission_level, targetUser.id, universe.id]);
            }
        }
        else {
            query = (0, utils_1.executeQuery)(`
        INSERT INTO authoruniverse (permission_level, universe_id, user_id) VALUES (?, ?, ?)`, [permission_level, universe.id, targetUser.id]);
        }
        await (0, utils_1.executeQuery)('DELETE FROM universeaccessrequest WHERE universe_id = ? AND user_id = ?', [universe.id, targetUser.id]);
        return await query;
    }
    async putUserFollowing(user, shortname, isFollowing) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const universe = await this.getOne(user, { shortname }, utils_1.perms.READ);
        let query;
        if (user.id in universe.followers) {
            query = (0, utils_1.executeQuery)(`
        UPDATE followeruniverse 
        SET is_following = ? 
        WHERE user_id = ? AND universe_id = ?;`, [isFollowing, user.id, universe.id]);
        }
        else {
            query = (0, utils_1.executeQuery)(`
        INSERT INTO followeruniverse (is_following, universe_id, user_id) VALUES (?, ?, ?)`, [isFollowing, universe.id, user.id]);
        }
        return await query;
    }
    async putUserSponsoring(user, shortname, tier) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const universe = await this.getOne(user, { shortname }, utils_1.perms.ADMIN);
        if (universe.sponsoring_user !== null && universe.sponsoring_user !== user.id) {
            await this.getOne(user, { shortname }, utils_1.perms.OWNER); // check if we have owner permissions
        }
        if (universe.tier === tier)
            return; // Already at desired tier, do nothing
        let query;
        if (tier === utils_1.tiers.FREE) {
            if (universe.tier === null)
                return; // Already free, do nothing
            query = (0, utils_1.executeQuery)(`DELETE FROM usersponsoreduniverse WHERE universe_id = ?`, [universe.id]);
        }
        else {
            if (user.plan === undefined)
                throw new errors_1.ValidationError('User plan is required.');
            const sponsored = await this.api.user.getSponsoredUniverses(user);
            const sponsoredAtTier = sponsored.filter(row => row.tier === tier)[0]?.universes.length;
            if (sponsoredAtTier >= utils_1.tierAllowance[user.plan][tier])
                throw new errors_1.ForbiddenError();
            if (universe.tier === null) {
                query = (0, utils_1.executeQuery)(`
          INSERT INTO usersponsoreduniverse (universe_id, user_id, tier) VALUES (?, ?, ?)`, [universe.id, user.id, tier]);
            }
            else {
                query = (0, utils_1.executeQuery)(`
          UPDATE usersponsoreduniverse 
          SET user_id = ? AND tier = ?
          WHERE universe_id = ?;`, [user.id, tier, universe.id]);
            }
        }
        await query;
    }
    async getUserAccessRequestIfExists(user, shortname) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const universe = (await (0, utils_1.executeQuery)('SELECT * FROM universe WHERE shortname = ?', [shortname]))[0];
        if (!universe)
            throw new errors_1.NotFoundError();
        const request = (await (0, utils_1.executeQuery)('SELECT ua.*, user.username FROM universeaccessrequest AS ua INNER JOIN user ON user.id = ua.user_id WHERE ua.universe_id = ? AND ua.user_id = ?', [universe.id, user.id]))[0];
        if (!request)
            return null;
        return request;
    }
    async getAccessRequests(user, shortname) {
        return this._getAccessRequests(user, shortname, false);
    }
    async getAccessInvites(user, shortname) {
        return this._getAccessRequests(user, shortname, true);
    }
    async _getAccessRequests(user, shortname, getInvites) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const universe = await this.getOne(user, { shortname }, utils_1.perms.ADMIN);
        const requests = await (0, utils_1.executeQuery)('SELECT ua.*, user.username FROM universeaccessrequest AS ua INNER JOIN user ON user.id = ua.user_id WHERE ua.universe_id = ? AND ua.is_invite = ?', [universe.id, getInvites]);
        return requests;
    }
    async putAccessRequest(user, shortname, permissionLevel) {
        await this._putAccessRequest(user, shortname, permissionLevel);
        user = user;
        const universe = (await (0, utils_1.executeQuery)('SELECT * FROM universe WHERE shortname = ?', [shortname]))[0];
        const target = await this.api.user.getOne({ 'user.id': universe.author_id }).catch((0, utils_1.handleAsNull)(errors_1.NotFoundError));
        if (target) {
            await this.api.notification.notify(target, this.api.notification.types.UNIVERSE, {
                title: 'Universe Access Request',
                body: `${user.username} is requesting ${permText[permissionLevel]} permissions on your universe ${universe.title}.`,
                icon: (0, utils_1.getPfpUrl)(user),
                clickUrl: `/universes/${universe.shortname}/permissions`,
            });
        }
    }
    async putAccessInvite(user, shortname, invitee, permissionLevel) {
        const universe = await this.api.universe.getOne(user, { shortname }, Math.max(utils_1.perms.ADMIN, permissionLevel)); // Validate we have permssion to invite.
        user = user;
        const inviteChanged = await this._putAccessRequest(invitee, universe.shortname, permissionLevel, user);
        if (inviteChanged) {
            await this.api.notification.notify(invitee, this.api.notification.types.UNIVERSE, {
                title: `Invitation to ${universe.title}`,
                body: `${user.username} is inviting you to ${universe.title} with ${permText[permissionLevel]} permissions.`,
                icon: (0, utils_1.getPfpUrl)(user),
                clickUrl: `/universes/${universe.shortname}`,
            }, `invite-${shortname}-${invitee.username}`);
        }
    }
    async _putAccessRequest(user, shortname, permissionLevel, invitingAdmin) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const universe = (await (0, utils_1.executeQuery)('SELECT * FROM universe WHERE shortname = ?', [shortname]))[0];
        if (!universe)
            throw new errors_1.NotFoundError();
        const request = await this.getUserAccessRequestIfExists(user, shortname);
        if (request) {
            if (request.permission_level >= permissionLevel)
                return false;
            else
                await this.delAccessRequest(user, shortname, user);
        }
        await (0, utils_1.executeQuery)('INSERT INTO universeaccessrequest (universe_id, user_id, permission_level, is_invite, inviter_id) VALUES (?, ?, ?, ?, ?)', [universe.id, user.id, permissionLevel, invitingAdmin !== undefined, invitingAdmin?.id ?? null]);
        return true;
    }
    async delAccessRequest(user, shortname, requestingUser) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        if (!requestingUser)
            throw new errors_1.ValidationError('Requesting user is required.');
        const permsUniverse = await this.getOne(user, { shortname }, utils_1.perms.ADMIN).catch((0, utils_1.handleAsNull)(errors_1.ForbiddenError));
        if (!(permsUniverse || (user.id === requestingUser.id)))
            throw new errors_1.ForbiddenError();
        const universe = (await (0, utils_1.executeQuery)('SELECT * FROM universe WHERE shortname = ?', [shortname]))[0];
        await (0, utils_1.executeQuery)('DELETE FROM universeaccessrequest WHERE universe_id = ? AND user_id = ?', [universe.id, requestingUser.id]);
    }
    async del(user, shortname) {
        const universe = await this.getOne(user, { shortname }, utils_1.perms.OWNER);
        await (0, utils_1.withTransaction)(async (conn) => {
            await conn.execute(`
        DELETE comment
        FROM comment
        INNER JOIN threadcomment AS tc ON tc.comment_id = comment.id
        INNER JOIN discussion ON tc.thread_id = discussion.id
        WHERE discussion.universe_id = ?;
      `, [universe.id]);
            await conn.execute(`
        DELETE comment
        FROM comment
        INNER JOIN itemcomment AS ic ON ic.comment_id = comment.id
        INNER JOIN item ON ic.item_id = item.id
        WHERE item.universe_id = ?;
      `, [universe.id]);
            await conn.execute(`DELETE FROM universe WHERE id = ?;`, [universe.id]);
        });
    }
}
exports.UniverseAPI = UniverseAPI;
