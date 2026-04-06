import { executeQuery, parseData, perms, getPfpUrl, withTransaction } from '../utils';
import { API } from '..';
import { User } from './user';
import { ResultSetHeader } from 'mysql2';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../../errors';

export type Thread = {
  id: number,
  title: string,
  universe_id: number,
  universe_short: string,
  notifs_enabled?: boolean,
  comment_count?: number,
  first_activity?: Date,
  last_activity?: Date,
};

export type Comment = {
  id: number,
  body: string,
  author_id: number,
  reply_to: number,
  created_at: Date,
};

export class DiscussionAPI {
  readonly api: API;

  constructor(api: API) {
    this.api = api;
  }

  async getThreads(user: User | undefined, options?, canPost = false, includeExtra = false): Promise<Thread[]> {
    const parsedOptions = parseData(options);
    const filter = user
      ? (canPost
        ? `
            (universe.is_public = 1 AND universe.discussion_open)
            OR (au_filter.user_id = ${user.id} AND (
              (au_filter.permission_level >= ${perms.READ} AND universe.discussion_open)
              OR au_filter.permission_level >= ${perms.COMMENT}
            ))
          `
        : `
            universe.is_public = 1 OR (au_filter.user_id = ${user.id} AND au_filter.permission_level >= ${perms.READ})
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
    const data = await executeQuery(queryString, options && parsedOptions.values) as Thread[];
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
  async getCommentsByThread(user: User | undefined, threadId: number, validate = true, inclCommenters = false): Promise<[Comment[], User[]?]> {
    if (validate) {
      const threads = await this.getThreads(user, { 'discussion.id': threadId });
      const thread = threads[0];
      if (!thread) throw new NotFoundError();
    }
    const queryString1 = `
        SELECT comment.*
        FROM comment
        INNER JOIN threadcomment AS tc ON tc.comment_id = comment.id
        WHERE tc.thread_id = ?`;
    const comments = await executeQuery(queryString1, [threadId]) as Comment[];
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
      const users = await executeQuery(queryString2, [threadId]) as User[];
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
  async getCommentsByItem(itemId: number, inclCommenters = false): Promise<[Comment[], User[]?]> {
    const queryString1 = `
        SELECT comment.*
        FROM comment
        INNER JOIN itemcomment AS ic ON ic.comment_id = comment.id
        WHERE ic.item_id = ?`;
    const comments = await executeQuery(queryString1, [itemId]) as Comment[];
    if (inclCommenters) {
      const queryString2 = `
          SELECT user.id, user.username, user.email, (ui.user_id IS NOT NULL) as hasPfp
          FROM user
          INNER JOIN comment ON user.id = comment.author_id
          INNER JOIN itemcomment AS ic ON ic.comment_id = comment.id
          LEFT JOIN userimage AS ui ON user.id = ui.user_id
          WHERE ic.item_id = ?
          GROUP BY user.id`;
      const users = await executeQuery(queryString2, [itemId]) as User[];
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
  async getCommentsByChapter(chapterId: number, inclCommenters = false): Promise<[Comment[], User[]?]> {
    const queryString1 = `
        SELECT comment.*
        FROM comment
        INNER JOIN storychaptercomment AS scc ON scc.comment_id = comment.id
        WHERE scc.chapter_id = ?`;
    const comments = await executeQuery(queryString1, [chapterId]) as Comment[];
    if (inclCommenters) {
      const queryString2 = `
          SELECT user.id, user.username, user.email, (ui.user_id IS NOT NULL) as hasPfp
          FROM user
          INNER JOIN comment ON user.id = comment.author_id
          INNER JOIN storychaptercomment AS scc ON scc.comment_id = comment.id
          LEFT JOIN userimage AS ui ON user.id = ui.user_id
          WHERE scc.chapter_id = ?
          GROUP BY user.id`;
      const users = await executeQuery(queryString2, [chapterId]) as User[];
      return [comments, users];
    }
    return [comments];
  }

  async postUniverseThread(user: User | undefined, universeShortname: string, { title }): Promise<ResultSetHeader> {
    if (!user) throw new UnauthorizedError();
    const universe = await this.api.universe.getOne(user, { shortname: universeShortname }, perms.READ);
    if (!universe.discussion_enabled) throw new ForbiddenError();
    if (!universe.discussion_open && universe.author_permissions[user.id] < perms.COMMENT) throw new ForbiddenError();
    if (!title) throw new ValidationError('Title is required for universe discussion threads.');

    const queryString = `INSERT INTO discussion (title, universe_id) VALUES (?, ?);`;
    const data = await executeQuery<ResultSetHeader>(queryString, [title, universe.id]);
    return data;
  }

  async forEachUserToNotify(thread: Thread, callback: (user: User) => Promise<void>): Promise<void> {
    const targetIDs = (await executeQuery(`SELECT user_id FROM threadnotification WHERE thread_id = ? AND is_enabled`, [thread.id])).map(row => row.user_id);
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
  async postCommentToThread(user: User | undefined, threadId: number, { body, reply_to }: { body: string, reply_to?: number }): Promise<ResultSetHeader> {
    if (!user) throw new UnauthorizedError();
    const threads = await this.getThreads(user, { 'discussion.id': threadId }, true);
    const thread = threads[0];
    if (!thread) throw new NotFoundError();
    if (!body) throw new ValidationError('Cannot post empty comments.');

    let data;
    await withTransaction(async (conn) => {
      const queryString1 = `INSERT INTO comment (body, author_id, reply_to, created_at) VALUES (?, ?, ?, ?);`;
      [data] = await conn.execute(queryString1, [body, user.id, reply_to ?? null, new Date()]);
      const queryString2 = `INSERT INTO threadcomment (thread_id, comment_id) VALUES (?, ?)`;
      await conn.execute(queryString2, [thread.id, data.insertId])
    });

    this.forEachUserToNotify(thread, async (target) => {
      if (target.id === user.id) return;
      await this.api.notification.notify(target, this.api.notification.types.COMMENTS, {
        title: `${user.username} commented in ${thread.title}:`,
        body: body,
        icon: getPfpUrl(user),
        clickUrl: `/universes/${thread.universe_short}/discuss/${thread.id}`,
      });
    })

    return data;
  }

  async postCommentToItem(user: User | undefined, universeShortname: string, itemShortname: string, { body, reply_to }: { body: string, reply_to?: number }): Promise<ResultSetHeader> {
    if (!user) throw new UnauthorizedError();
    const universe = await this.api.universe.getOne(user, { shortname: universeShortname }, perms.READ);
    if (!universe.discussion_enabled) throw new ForbiddenError();
    const item = await this.api.item.getByUniverseAndItemShortnames(
      user,
      universeShortname,
      itemShortname,
      universe.discussion_open ? perms.READ : perms.COMMENT,
      true,
    );
    if (!body) throw new ValidationError('Cannot post empty comments.');

    let data;
    await withTransaction(async (conn) => {
      const queryString1 = `INSERT INTO comment (body, author_id, reply_to, created_at) VALUES (?, ?, ?, ?);`;
      [data] = await conn.execute(queryString1, [body, user.id, reply_to ?? null, new Date()]);
      const queryString2 = `INSERT INTO itemcomment (item_id, comment_id) VALUES (?, ?)`;
      await conn.execute(queryString2, [item.id, data.insertId]);
    });

    await this.api.item.forEachUserToNotify(item, async (target) => {
      if (target.id === user.id) return;
      await this.api.notification.notify(target, this.api.notification.types.COMMENTS, {
        title: `${user.username} commented on ${item.title}:`,
        body: body,
        icon: getPfpUrl(user),
        clickUrl: `/universes/${universeShortname}/items/${itemShortname}`,
      });
    })

    return data;
  }
  async postCommentToChapter(user: User | undefined, shortname: string, index: number, { body, reply_to }: { body: string, reply_to?: number }): Promise<ResultSetHeader> {
    if (!user) throw new UnauthorizedError();
    const story = await this.api.story.getOne(user, { 'story.shortname': shortname });
    const chapter = await this.api.story.getChapter(user, shortname, index);
    if (!chapter.is_published) throw new ForbiddenError();
    if (!body) throw new ValidationError('Cannot post empty comments.');

    let data;
    await withTransaction(async (conn) => {
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
          icon: getPfpUrl(user),
          clickUrl: `/stories/${story.shortname}/${chapter.chapter_number}`,
        });
      }
    }

    return data;
  }

  async subscribeToThread(user: User | undefined, threadId: number, isSubscribed: boolean): Promise<ResultSetHeader> {
    if (!user) throw new UnauthorizedError();
    const threads = await this.getThreads(user, { 'discussion.id': threadId }, true);
    const thread = threads[0];
    if (!thread) throw new NotFoundError();

    return await executeQuery<ResultSetHeader>(`
        INSERT INTO threadnotification (thread_id, user_id, is_enabled) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE is_enabled = ?
      `, [thread.id, user.id, isSubscribed, isSubscribed]);
  }

  async deleteThreadComment(user: User | undefined, threadId: number, commentId: number): Promise<void> {
    if (!user) throw new UnauthorizedError();
    const threads = await this.getThreads(user, { 'discussion.id': threadId });
    const thread = threads[0];
    if (!thread) throw new NotFoundError();

    const comment = (await executeQuery(`
        SELECT comment.*
        FROM comment
        INNER JOIN threadcomment AS tc ON tc.comment_id = comment.id
        WHERE tc.thread_id = ? AND comment.id = ?
      `, [thread.id, commentId]))[0];
    if (comment.author_id !== user.id) {
      await this.api.universe.getOne(user, { 'universe.shortname': thread.universe_short }, perms.ADMIN); // we need at least admin access to delete a comment that isn't ours
    }

    await executeQuery('UPDATE comment SET body = NULL, author_id = NULL WHERE id = ?', [commentId]);
  }

  async deleteItemComment(user: User | undefined, universeShortname: string, itemShortname: string, commentId: number): Promise<void> {
    if (!user) throw new UnauthorizedError();

    const item = await this.api.item.getByUniverseAndItemShortnames(
      user,
      universeShortname,
      itemShortname,
      perms.READ,
      true,
    );

    const comment = (await executeQuery(`
        SELECT comment.*
        FROM comment
        INNER JOIN itemcomment AS ic ON ic.comment_id = comment.id
        WHERE ic.item_id = ? AND comment.id = ?
      `, [item.id, commentId]))[0];
    if (comment.author_id !== user.id) {
      await this.api.universe.getOne(user, { 'universe.shortname': item.universe_short }, perms.ADMIN); // we need at least admin access to delete a comment that isn't ours
    }

    await executeQuery('UPDATE comment SET body = NULL, author_id = NULL WHERE id = ?', [commentId]);
  }
}
