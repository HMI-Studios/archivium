import { SqlBool } from 'kysely';
import { kysely } from '../../db/kysely';
import { perms, getPfpUrl } from '../utils';
import { API } from '..';
import { User } from './user';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../../errors';

export type Thread = {
  id: number,
  title: string,
  universe_id: number,
  universe_short: string,
  notifs_enabled?: boolean | null,
  comment_count?: number | null,
  first_activity?: Date | null,
  last_activity?: Date | null,
};

export type Comment = {
  id: number,
  body: string | null,
  author_id: number | null,
  reply_to: number | null,
  created_at: Date,
};

export type CommenterUserBasic = {
  id: number,
  username: string,
  email: string,
  hasPfp: SqlBool,
};

export type CommenterUser = CommenterUserBasic & {
  plan: number | null,
};

export class DiscussionAPI {
  readonly api: API;

  constructor(api: API) {
    this.api = api;
  }

  async getThreads(user: User | undefined, options?: Record<string, unknown>, canPost = false, includeExtra = false): Promise<Thread[]> {
    let query = kysely
      .selectFrom('discussion')
      .innerJoin('universe', 'universe.id', 'discussion.universe_id')
      .innerJoin('authoruniverse as au_filter', (join) => {
        join = join.onRef('universe.id', '=', 'au_filter.universe_id');
        if (!user) return join.on('universe.is_public', '=', true);
        if (canPost) {
          return join.on((eb) => eb.or([
            eb.and([eb('universe.is_public', '=', true), eb('universe.discussion_open', '=', true)]),
            eb.and([
              eb('au_filter.user_id', '=', user.id),
              eb.or([
                eb.and([eb('au_filter.permission_level', '>=', perms.READ), eb('universe.discussion_open', '=', true)]),
                eb('au_filter.permission_level', '>=', perms.COMMENT),
              ]),
            ]),
          ]));
        }
        return join.on((eb) => eb.or([
          eb('universe.is_public', '=', true),
          eb.and([eb('au_filter.user_id', '=', user.id), eb('au_filter.permission_level', '>=', perms.READ)]),
        ]));
      })
      .selectAll('discussion')
      .select('universe.shortname as universe_short')
      .where('universe.discussion_enabled', '=', true)
      .groupBy('discussion.id')
      .$if(includeExtra, (qb) => qb
        .leftJoin(
          (eb) => eb
            .selectFrom('comment')
            .innerJoin('threadcomment as tc', 'tc.comment_id', 'comment.id')
            .select((eb2) => [
              eb2.fn.count<number>('comment.id').as('comment_count'),
              eb2.fn.min<Date>('comment.created_at').as('first_activity'),
              eb2.fn.max<Date>('comment.created_at').as('last_activity'),
              'tc.thread_id',
            ])
            .groupBy('tc.thread_id')
            .as('comments'),
          (join) => join.onRef('comments.thread_id', '=', 'discussion.id'),
        )
        .select(['comments.comment_count', 'comments.first_activity', 'comments.last_activity']))
      .$if(user !== undefined, (qb) => qb
        .leftJoin('threadnotification as tn', (join) => join
          .onRef('tn.thread_id', '=', 'discussion.id')
          .on('tn.user_id', '=', user!.id))
        .select('tn.is_enabled as notifs_enabled'));

    for (const [key, value] of Object.entries(options ?? {})) {
      if (value === undefined) continue;
      query = query.where(kysely.dynamic.ref(key), '=', value);
    }

    return await query.execute();
  }

  async getCommentsByThread(user: User | undefined, threadId: number, validate = true, inclCommenters = false): Promise<[Comment[], CommenterUser[]?]> {
    if (validate) {
      const threads = await this.getThreads(user, { 'discussion.id': threadId });
      const thread = threads[0];
      if (!thread) throw new NotFoundError();
    }

    const comments = await kysely
      .selectFrom('comment')
      .innerJoin('threadcomment as tc', 'tc.comment_id', 'comment.id')
      .selectAll('comment')
      .where('tc.thread_id', '=', threadId)
      .execute();

    if (inclCommenters) {
      const users = await kysely
        .selectFrom('user')
        .innerJoin('comment', 'user.id', 'comment.author_id')
        .innerJoin('threadcomment as tc', 'tc.comment_id', 'comment.id')
        .leftJoin('userimage as ui', 'user.id', 'ui.user_id')
        .leftJoin('userplan', 'user.id', 'userplan.user_id')
        .select((eb) => [
          'user.id',
          'user.username',
          'user.email',
          eb('ui.user_id', 'is not', null).as('hasPfp'),
          'userplan.plan',
        ])
        .where('tc.thread_id', '=', threadId)
        .groupBy(['user.id', 'userplan.plan'])
        .execute();
      return [comments, users];
    }
    return [comments];
  }

  /**
   * This assumes you have already validated access to the item!
   */
  async getCommentsByItem(itemId: number, inclCommenters = false): Promise<[Comment[], CommenterUserBasic[]?]> {
    const comments = await kysely
      .selectFrom('comment')
      .innerJoin('itemcomment as ic', 'ic.comment_id', 'comment.id')
      .selectAll('comment')
      .where('ic.item_id', '=', itemId)
      .execute();

    if (inclCommenters) {
      const users = await kysely
        .selectFrom('user')
        .innerJoin('comment', 'user.id', 'comment.author_id')
        .innerJoin('itemcomment as ic', 'ic.comment_id', 'comment.id')
        .leftJoin('userimage as ui', 'user.id', 'ui.user_id')
        .select((eb) => ['user.id', 'user.username', 'user.email', eb('ui.user_id', 'is not', null).as('hasPfp')])
        .where('ic.item_id', '=', itemId)
        .groupBy('user.id')
        .execute();
      return [comments, users];
    }
    return [comments];
  }

  /**
   * This assumes you have already validated access to the chapter!
   */
  async getCommentsByChapter(chapterId: number, inclCommenters = false): Promise<[Comment[], CommenterUserBasic[]?]> {
    const comments = await kysely
      .selectFrom('comment')
      .innerJoin('storychaptercomment as scc', 'scc.comment_id', 'comment.id')
      .selectAll('comment')
      .where('scc.chapter_id', '=', chapterId)
      .execute();

    if (inclCommenters) {
      const users = await kysely
        .selectFrom('user')
        .innerJoin('comment', 'user.id', 'comment.author_id')
        .innerJoin('storychaptercomment as scc', 'scc.comment_id', 'comment.id')
        .leftJoin('userimage as ui', 'user.id', 'ui.user_id')
        .select((eb) => ['user.id', 'user.username', 'user.email', eb('ui.user_id', 'is not', null).as('hasPfp')])
        .where('scc.chapter_id', '=', chapterId)
        .groupBy('user.id')
        .execute();
      return [comments, users];
    }
    return [comments];
  }

  async postUniverseThread(user: User | undefined, universeShortname: string, { title }): Promise<{ insertId: number }> {
    if (!user) throw new UnauthorizedError();
    const universe = await this.api.universe.getOne(user, { shortname: universeShortname }, perms.READ);
    if (!universe.discussion_enabled) throw new ForbiddenError();
    if (!universe.discussion_open && universe.author_permissions[user.id] < perms.COMMENT) throw new ForbiddenError();
    if (!title) throw new ValidationError('Title is required for universe discussion threads.');

    const result = await kysely
      .insertInto('discussion')
      .values({ title, universe_id: universe.id })
      .executeTakeFirstOrThrow();

    return { insertId: Number(result.insertId ?? 0) };
  }

  async forEachUserToNotify(thread: Thread, callback: (user: User) => Promise<void>): Promise<void> {
    const rows = await kysely
      .selectFrom('threadnotification')
      .select('user_id')
      .where('thread_id', '=', thread.id)
      .where('is_enabled', '=', true)
      .execute();
    for (const { user_id } of rows) {
      const user = await this.api.user.getOne({ 'user.id': user_id });
      await callback(user);
    }
  }

  async postCommentToThread(user: User | undefined, threadId: number, { body, reply_to }: { body: string, reply_to?: number }): Promise<{ insertId: number }> {
    if (!user) throw new UnauthorizedError();
    const threads = await this.getThreads(user, { 'discussion.id': threadId }, true);
    const thread = threads[0];
    if (!thread) throw new NotFoundError();
    if (!body) throw new ValidationError('Cannot post empty comments.');

    const insertId = await kysely.transaction().execute(async (trx) => {
      const result = await trx
        .insertInto('comment')
        .values({ body, author_id: user.id, reply_to: reply_to ?? null, created_at: new Date() })
        .executeTakeFirstOrThrow();
      const commentId = Number(result.insertId ?? 0);
      await trx.insertInto('threadcomment').values({ thread_id: thread.id, comment_id: commentId }).execute();
      return commentId;
    });

    this.forEachUserToNotify(thread, async (target) => {
      if (target.id === user.id) return;
      await this.api.notification.notify(target, this.api.notification.types.COMMENTS, {
        title: `${user.username} commented in ${thread.title}:`,
        body: null,
        icon: getPfpUrl(user),
        clickUrl: `/universes/${thread.universe_short}/discuss/${thread.id}`,
      }, undefined, insertId);
    });

    return { insertId };
  }

  async postCommentToItem(user: User | undefined, universeShortname: string, itemShortname: string, { body, reply_to }: { body: string, reply_to?: number }): Promise<{ insertId: number }> {
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

    const insertId = await kysely.transaction().execute(async (trx) => {
      const result = await trx
        .insertInto('comment')
        .values({ body, author_id: user.id, reply_to: reply_to ?? null, created_at: new Date() })
        .executeTakeFirstOrThrow();
      const commentId = Number(result.insertId ?? 0);
      await trx.insertInto('itemcomment').values({ item_id: item.id, comment_id: commentId }).execute();
      return commentId;
    });

    await this.api.item.forEachUserToNotify(item, async (target) => {
      if (target.id === user.id) return;
      await this.api.notification.notify(target, this.api.notification.types.COMMENTS, {
        title: `${user.username} commented on ${item.title}:`,
        body: null,
        icon: getPfpUrl(user),
        clickUrl: `/universes/${universeShortname}/items/${itemShortname}`,
      }, undefined, insertId);
    });

    return { insertId };
  }

  async postCommentToChapter(user: User | undefined, shortname: string, index: number, { body, reply_to }: { body: string, reply_to?: number }): Promise<{ insertId: number }> {
    if (!user) throw new UnauthorizedError();
    const story = await this.api.story.getOne(user, { 'story.shortname': shortname });
    const chapter = await this.api.story.getChapter(user, shortname, index);
    if (!chapter.is_published) throw new ForbiddenError();
    if (!body) throw new ValidationError('Cannot post empty comments.');

    const insertId = await kysely.transaction().execute(async (trx) => {
      const result = await trx
        .insertInto('comment')
        .values({ body, author_id: user.id, reply_to: reply_to ?? null, created_at: new Date() })
        .executeTakeFirstOrThrow();
      const commentId = Number(result.insertId ?? 0);
      await trx.insertInto('storychaptercomment').values({ chapter_id: chapter.id, comment_id: commentId }).execute();
      return commentId;
    });

    if (user.id !== story.author_id) {
      const target = await this.api.user.getOne({ id: story.author_id });
      if (target) {
        await this.api.notification.notify(target, this.api.notification.types.COMMENTS, {
          title: `${user.username} commented on ${chapter.title} of ${story.title}:`,
          body: null,
          icon: getPfpUrl(user),
          clickUrl: `/stories/${story.shortname}/${chapter.chapter_number}`,
        }, undefined, insertId);
      }
    }

    return { insertId };
  }

  async subscribeToThread(user: User | undefined, threadId: number, isSubscribed: boolean): Promise<{ numInsertedOrUpdatedRows: number }> {
    if (!user) throw new UnauthorizedError();
    const threads = await this.getThreads(user, { 'discussion.id': threadId }, true);
    const thread = threads[0];
    if (!thread) throw new NotFoundError();

    const result = await kysely
      .insertInto('threadnotification')
      .values({ thread_id: thread.id, user_id: user.id, is_enabled: isSubscribed })
      .onDuplicateKeyUpdate({ is_enabled: isSubscribed })
      .executeTakeFirstOrThrow();

    return { numInsertedOrUpdatedRows: Number(result.numInsertedOrUpdatedRows ?? 0) };
  }

  async deleteThreadComment(user: User | undefined, threadId: number, commentId: number): Promise<void> {
    if (!user) throw new UnauthorizedError();
    const threads = await this.getThreads(user, { 'discussion.id': threadId });
    const thread = threads[0];
    if (!thread) throw new NotFoundError();

    const comment = await kysely
      .selectFrom('comment')
      .innerJoin('threadcomment as tc', 'tc.comment_id', 'comment.id')
      .selectAll('comment')
      .where('tc.thread_id', '=', thread.id)
      .where('comment.id', '=', commentId)
      .executeTakeFirst();
    if (!comment) throw new NotFoundError();
    if (comment.author_id !== user.id) {
      await this.api.universe.getOne(user, { 'universe.shortname': thread.universe_short }, perms.ADMIN); // we need at least admin access to delete a comment that isn't ours
    }

    await kysely.updateTable('comment').set({ body: null, author_id: null }).where('id', '=', commentId).execute();
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

    const comment = await kysely
      .selectFrom('comment')
      .innerJoin('itemcomment as ic', 'ic.comment_id', 'comment.id')
      .selectAll('comment')
      .where('ic.item_id', '=', item.id)
      .where('comment.id', '=', commentId)
      .executeTakeFirst();
    if (!comment) throw new NotFoundError();
    if (comment.author_id !== user.id) {
      await this.api.universe.getOne(user, { 'universe.shortname': item.universe_short }, perms.ADMIN); // we need at least admin access to delete a comment that isn't ours
    }

    await kysely.updateTable('comment').set({ body: null, author_id: null }).where('id', '=', commentId).execute();
  }
}
