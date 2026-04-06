"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscussionAPI = void 0;
const utils_1 = require("../utils");
const errors_1 = require("../../errors");
class DiscussionAPI {
    api;
    constructor(api) {
        this.api = api;
    }
    async getThreads(user, options, canPost = false, includeExtra = false) {
        const parsedOptions = (0, utils_1.parseData)(options);
        const filter = user
            ? (canPost
                ? `
            (universe.is_public = 1 AND universe.discussion_open)
            OR (au_filter.user_id = ${user.id} AND (
              (au_filter.permission_level >= ${utils_1.perms.READ} AND universe.discussion_open)
              OR au_filter.permission_level >= ${utils_1.perms.COMMENT}
            ))
          `
                : `
            universe.is_public = 1 OR (au_filter.user_id = ${user.id} AND au_filter.permission_level >= ${utils_1.perms.READ})
          `)
            : 'universe.is_public = 1';
        const conditionString = options ? `AND ${parsedOptions.strings.join(' AND ')}` : '';
        const queryString = `
        SELECT
          ${includeExtra ? 'comments.*,' : ''}
          ${user ? 'tn.is_enabled AS notifs_enabled,' : ''}
          discussion.*,
          universe.shortname AS universe_short
        FROM discussion
        INNER JOIN universe ON universe.id = discussion.universe_id
        INNER JOIN authoruniverse as au_filter
          ON universe.id = au_filter.universe_id AND (
            ${filter}
          )
        LEFT JOIN authoruniverse as au ON universe.id = au.universe_id
        ${includeExtra ? `
          LEFT JOIN (
            SELECT DISTINCT
              COUNT(comment.id) as comment_count,
              MIN(comment.created_at) as first_activity,
              MAX(comment.created_at) as last_activity,
              tc.thread_id
            FROM comment
            INNER JOIN threadcomment AS tc ON tc.comment_id = comment.id
            GROUP BY thread_id
          ) comments ON comments.thread_id = discussion.id
        ` : ''}
        ${user ? `
          LEFT JOIN threadnotification AS tn ON tn.thread_id = discussion.id AND tn.user_id = ${user.id}
        ` : ''}
        WHERE universe.discussion_enabled
        ${conditionString}
        GROUP BY discussion.id;`;
        const data = await (0, utils_1.executeQuery)(queryString, options && parsedOptions.values);
        return data;
    }
    /**
     *
     * @param {*} user
     * @param {*} threadId
     * @param {*} validate
     * @param {*} inclCommenters
     * @returns {Promise<[number, QueryResult, QueryResult?]>}
     */
    async getCommentsByThread(user, threadId, validate = true, inclCommenters = false) {
        if (validate) {
            const threads = await this.getThreads(user, { 'discussion.id': threadId });
            const thread = threads[0];
            if (!thread)
                throw new errors_1.NotFoundError();
        }
        const queryString1 = `
        SELECT comment.*
        FROM comment
        INNER JOIN threadcomment AS tc ON tc.comment_id = comment.id
        WHERE tc.thread_id = ?`;
        const comments = await (0, utils_1.executeQuery)(queryString1, [threadId]);
        if (inclCommenters) {
            const queryString2 = `
          SELECT user.id, user.username, user.email, (ui.user_id IS NOT NULL) as hasPfp, userplan.plan
          FROM user
          INNER JOIN comment ON user.id = comment.author_id
          INNER JOIN threadcomment AS tc ON tc.comment_id = comment.id
          LEFT JOIN userimage AS ui ON user.id = ui.user_id
          LEFT JOIN userplan ON user.id = userplan.user_id
          WHERE tc.thread_id = ?
          GROUP BY user.id, userplan.plan`;
            const users = await (0, utils_1.executeQuery)(queryString2, [threadId]);
            return [comments, users];
        }
        return [comments];
    }
    /**
     * This assumes you have already validated access to the item!
     * @param {*} itemId
     * @param {*} inclCommenters
     * @returns {Promise<[number, QueryResult, QueryResult?]>}
     */
    async getCommentsByItem(itemId, inclCommenters = false) {
        const queryString1 = `
        SELECT comment.*
        FROM comment
        INNER JOIN itemcomment AS ic ON ic.comment_id = comment.id
        WHERE ic.item_id = ?`;
        const comments = await (0, utils_1.executeQuery)(queryString1, [itemId]);
        if (inclCommenters) {
            const queryString2 = `
          SELECT user.id, user.username, user.email, (ui.user_id IS NOT NULL) as hasPfp
          FROM user
          INNER JOIN comment ON user.id = comment.author_id
          INNER JOIN itemcomment AS ic ON ic.comment_id = comment.id
          LEFT JOIN userimage AS ui ON user.id = ui.user_id
          WHERE ic.item_id = ?
          GROUP BY user.id`;
            const users = await (0, utils_1.executeQuery)(queryString2, [itemId]);
            return [comments, users];
        }
        return [comments];
    }
    /**
     * This assumes you have already validated access to the chapter!
     * @param {*} chapterId
     * @param {*} inclCommenters
     * @returns {Promise<[number, QueryResult, QueryResult?]>}
     */
    async getCommentsByChapter(chapterId, inclCommenters = false) {
        const queryString1 = `
        SELECT comment.*
        FROM comment
        INNER JOIN storychaptercomment AS scc ON scc.comment_id = comment.id
        WHERE scc.chapter_id = ?`;
        const comments = await (0, utils_1.executeQuery)(queryString1, [chapterId]);
        if (inclCommenters) {
            const queryString2 = `
          SELECT user.id, user.username, user.email, (ui.user_id IS NOT NULL) as hasPfp
          FROM user
          INNER JOIN comment ON user.id = comment.author_id
          INNER JOIN storychaptercomment AS scc ON scc.comment_id = comment.id
          LEFT JOIN userimage AS ui ON user.id = ui.user_id
          WHERE scc.chapter_id = ?
          GROUP BY user.id`;
            const users = await (0, utils_1.executeQuery)(queryString2, [chapterId]);
            return [comments, users];
        }
        return [comments];
    }
    async postUniverseThread(user, universeShortname, { title }) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const universe = await this.api.universe.getOne(user, { shortname: universeShortname }, utils_1.perms.READ);
        if (!universe.discussion_enabled)
            throw new errors_1.ForbiddenError();
        if (!universe.discussion_open && universe.author_permissions[user.id] < utils_1.perms.COMMENT)
            throw new errors_1.ForbiddenError();
        if (!title)
            throw new errors_1.ValidationError('Title is required for universe discussion threads.');
        const queryString = `INSERT INTO discussion (title, universe_id) VALUES (?, ?);`;
        const data = await (0, utils_1.executeQuery)(queryString, [title, universe.id]);
        return data;
    }
    async forEachUserToNotify(thread, callback) {
        const targetIDs = (await (0, utils_1.executeQuery)(`SELECT user_id FROM threadnotification WHERE thread_id = ? AND is_enabled`, [thread.id])).map(row => row.user_id);
        for (const userID of targetIDs) {
            const user = await this.api.user.getOne({ 'user.id': userID });
            await callback(user);
        }
    }
    /**
     *
     * @param {*} user
     * @param {*} threadId
     * @param {{ body: string, reply_to?: number }} payload
     * @returns {Promise<[number, QueryResult?]>}
     */
    async postCommentToThread(user, threadId, { body, reply_to }) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const threads = await this.getThreads(user, { 'discussion.id': threadId }, true);
        const thread = threads[0];
        if (!thread)
            throw new errors_1.NotFoundError();
        if (!body)
            throw new errors_1.ValidationError('Cannot post empty comments.');
        let data;
        await (0, utils_1.withTransaction)(async (conn) => {
            const queryString1 = `INSERT INTO comment (body, author_id, reply_to, created_at) VALUES (?, ?, ?, ?);`;
            [data] = await conn.execute(queryString1, [body, user.id, reply_to ?? null, new Date()]);
            const queryString2 = `INSERT INTO threadcomment (thread_id, comment_id) VALUES (?, ?)`;
            await conn.execute(queryString2, [thread.id, data.insertId]);
        });
        this.forEachUserToNotify(thread, async (target) => {
            if (target.id === user.id)
                return;
            await this.api.notification.notify(target, this.api.notification.types.COMMENTS, {
                title: `${user.username} commented in ${thread.title}:`,
                body: body,
                icon: (0, utils_1.getPfpUrl)(user),
                clickUrl: `/universes/${thread.universe_short}/discuss/${thread.id}`,
            });
        });
        return data;
    }
    async postCommentToItem(user, universeShortname, itemShortname, { body, reply_to }) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const universe = await this.api.universe.getOne(user, { shortname: universeShortname }, utils_1.perms.READ);
        if (!universe.discussion_enabled)
            throw new errors_1.ForbiddenError();
        const item = await this.api.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, universe.discussion_open ? utils_1.perms.READ : utils_1.perms.COMMENT, true);
        if (!body)
            throw new errors_1.ValidationError('Cannot post empty comments.');
        let data;
        await (0, utils_1.withTransaction)(async (conn) => {
            const queryString1 = `INSERT INTO comment (body, author_id, reply_to, created_at) VALUES (?, ?, ?, ?);`;
            [data] = await conn.execute(queryString1, [body, user.id, reply_to ?? null, new Date()]);
            const queryString2 = `INSERT INTO itemcomment (item_id, comment_id) VALUES (?, ?)`;
            await conn.execute(queryString2, [item.id, data.insertId]);
        });
        await this.api.item.forEachUserToNotify(item, async (target) => {
            if (target.id === user.id)
                return;
            await this.api.notification.notify(target, this.api.notification.types.COMMENTS, {
                title: `${user.username} commented on ${item.title}:`,
                body: body,
                icon: (0, utils_1.getPfpUrl)(user),
                clickUrl: `/universes/${universeShortname}/items/${itemShortname}`,
            });
        });
        return data;
    }
    async postCommentToChapter(user, shortname, index, { body, reply_to }) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const story = await this.api.story.getOne(user, { 'story.shortname': shortname });
        const chapter = await this.api.story.getChapter(user, shortname, index);
        if (!chapter.is_published)
            throw new errors_1.ForbiddenError();
        if (!body)
            throw new errors_1.ValidationError('Cannot post empty comments.');
        let data;
        await (0, utils_1.withTransaction)(async (conn) => {
            const queryString1 = `INSERT INTO comment (body, author_id, reply_to, created_at) VALUES (?, ?, ?, ?);`;
            [data] = await conn.execute(queryString1, [body, user.id, reply_to ?? null, new Date()]);
            const queryString2 = `INSERT INTO storychaptercomment (chapter_id, comment_id) VALUES (?, ?)`;
            await conn.execute(queryString2, [chapter.id, data.insertId]);
        });
        if (user.id !== story.author_id) {
            const target = await this.api.user.getOne({ id: story.author_id });
            if (target) {
                await this.api.notification.notify(target, this.api.notification.types.COMMENTS, {
                    title: `${user.username} commented on ${chapter.title} of ${story.title}:`,
                    body: body,
                    icon: (0, utils_1.getPfpUrl)(user),
                    clickUrl: `/stories/${story.shortname}/${chapter.chapter_number}`,
                });
            }
        }
        return data;
    }
    async subscribeToThread(user, threadId, isSubscribed) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const threads = await this.getThreads(user, { 'discussion.id': threadId }, true);
        const thread = threads[0];
        if (!thread)
            throw new errors_1.NotFoundError();
        return await (0, utils_1.executeQuery)(`
        INSERT INTO threadnotification (thread_id, user_id, is_enabled) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE is_enabled = ?
      `, [thread.id, user.id, isSubscribed, isSubscribed]);
    }
    async deleteThreadComment(user, threadId, commentId) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const threads = await this.getThreads(user, { 'discussion.id': threadId });
        const thread = threads[0];
        if (!thread)
            throw new errors_1.NotFoundError();
        const comment = (await (0, utils_1.executeQuery)(`
        SELECT comment.*
        FROM comment
        INNER JOIN threadcomment AS tc ON tc.comment_id = comment.id
        WHERE tc.thread_id = ? AND comment.id = ?
      `, [thread.id, commentId]))[0];
        if (comment.author_id !== user.id) {
            await this.api.universe.getOne(user, { 'universe.shortname': thread.universe_short }, utils_1.perms.ADMIN); // we need at least admin access to delete a comment that isn't ours
        }
        await (0, utils_1.executeQuery)('UPDATE comment SET body = NULL, author_id = NULL WHERE id = ?', [commentId]);
    }
    async deleteItemComment(user, universeShortname, itemShortname, commentId) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const item = await this.api.item.getByUniverseAndItemShortnames(user, universeShortname, itemShortname, utils_1.perms.READ, true);
        const comment = (await (0, utils_1.executeQuery)(`
        SELECT comment.*
        FROM comment
        INNER JOIN itemcomment AS ic ON ic.comment_id = comment.id
        WHERE ic.item_id = ? AND comment.id = ?
      `, [item.id, commentId]))[0];
        if (comment.author_id !== user.id) {
            await this.api.universe.getOne(user, { 'universe.shortname': item.universe_short }, utils_1.perms.ADMIN); // we need at least admin access to delete a comment that isn't ours
        }
        await (0, utils_1.executeQuery)('UPDATE comment SET body = NULL, author_id = NULL WHERE id = ?', [commentId]);
    }
}
exports.DiscussionAPI = DiscussionAPI;
