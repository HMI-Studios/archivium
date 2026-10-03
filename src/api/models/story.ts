import { sql } from 'kysely';
import sharp from 'sharp';
import { API } from '..';
import { kysely } from '../../db/kysely';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../errors';
import { IndexedDocument } from '../../lib/tiptapHelpers';
import { BaseOptions, perms, withTransaction } from '../utils';
import { User } from './user';

export type StoryCover = {
  id: number,
  name: string,
  mimetype: string,
  data: Buffer,
};

export type Story = {
  id: number,
  title: string,
  shortname: string,
  summary: string | null,
  drafts_public: boolean,
  author_id: number | null,
  universe_id: number,
  created_at: Date,
  updated_at: Date,
  author: string,
  chapter_count: number,
  chapters: { [chapterNumber: number]: { title: string, is_published: boolean, created_at: Date } },
  universe: string,
  universe_short: string,
  is_published: boolean,
  shared?: boolean,
};

export type Chapter = {
  id: number,
  title: string,
  summary: string | null,
  chapter_number: number,
  body: IndexedDocument | null,
  story_id: number,
  is_published: boolean,
  created_at: Date,
  updated_at: Date,
};

export class StoryCoverAPI {
  readonly story: StoryAPI;

  constructor(story: StoryAPI) {
    this.story = story;
  }

  async getByShortname(user: User | undefined, shortname: string): Promise<StoryCover | undefined> {
    const story = await this.story.getOne(user, { 'story.shortname': shortname });
    if (!story) throw new NotFoundError();
    const image = await kysely
      .selectFrom('storyimage as si')
      .innerJoin('image', 'image.id', 'si.image_id')
      .select(['image.id', 'image.name', 'image.mimetype', 'image.data'])
      .where('si.story_id', '=', story.id)
      .executeTakeFirst();
    return image;
  }

  async post(user: User | undefined, file: Express.Multer.File | undefined, shortname: string): Promise<{ insertId: number }> {
    if (!file) throw new ValidationError('No file provided');

    const { originalname, buffer, mimetype } = file;
    const story = await this.story.getOne(user, { 'story.shortname': shortname }, perms.WRITE);

    const resizedBuffer = await sharp(buffer)
      .resize({
        width: 512,
        height: 800,
        fit: 'cover',
        withoutEnlargement: true
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    let data!: { insertId: number };
    await withTransaction(async (trx) => {
      // Kysely doesn't support DELETE-with-JOIN unfortunately
      await sql`
        DELETE image FROM image
        INNER JOIN storyimage AS ui ON ui.image_id = image.id
        WHERE ui.story_id = ${story.id}
      `.execute(trx);

      const inserted = await trx
        .insertInto('image')
        .values({ name: originalname.substring(0, 64), mimetype, data: resizedBuffer })
        .executeTakeFirstOrThrow();
      data = { insertId: Number(inserted.insertId ?? 0) };

      await trx
        .insertInto('storyimage')
        .values({ story_id: story.id, image_id: data.insertId })
        .execute();
    });
    return data;
  }

  async del(user: User | undefined, shortname: string): Promise<void> {
    const story = await this.story.getOne(user, { 'story.shortname': shortname }, perms.WRITE);
    // again Kysely doesn't support DELETE-with-JOIN
    await sql`
      DELETE image FROM image
      INNER JOIN storyimage AS ui ON ui.image_id = image.id
      WHERE ui.story_id = ${story.id}
    `.execute(kysely);
  }
}

export class StoryAPI {
  readonly cover: StoryCoverAPI;
  readonly api: API;

  constructor(api: API) {
    this.cover = new StoryCoverAPI(this);
    this.api = api;
  }

  async getOne(user, conditions, permissionsRequired = perms.READ, options: BaseOptions = {}): Promise<Story> {
    const stories = await this.getMany(user, conditions, permissionsRequired, options);
    const story = stories[0];
    if (!story) throw new NotFoundError();
    return story;
  }

  async getMany(user: User | undefined, conditions: { [key: string]: any } | null = null, permissionsRequired = perms.READ, options: BaseOptions = {}): Promise<Story[]> {
    if (permissionsRequired >= perms.WRITE) {
      if (!user) throw new UnauthorizedError();
      conditions = {
        ...(conditions ?? {}),
        'story.author_id': user.id,
      };
    }

    if (options.sort && !options.forceSort) {
      const validSorts = { 'title': true, 'created_at': true, 'updated_at': true, 'author': true };
      if (!validSorts[options.sort]) {
        delete options.sort;
      }
    }

    const query = kysely
      .selectFrom('story')
      .leftJoin('storychapter as sc', 'sc.story_id', 'story.id')
      .innerJoin('user as author', 'author.id', 'story.author_id')
      .innerJoin('universe', 'universe.id', 'story.universe_id')
      .leftJoin('authoruniverse as au_filter', (join) => join
        .onRef('universe.id', '=', 'au_filter.universe_id')
        .on('au_filter.user_id', '=', user?.id ?? -1)
        .on('au_filter.permission_level', '>=', perms.WRITE))
      .select([
        'story.id', 'story.title', 'story.shortname', 'story.summary', 'story.drafts_public',
        'story.author_id', 'story.universe_id', 'story.created_at', 'story.updated_at',
        'author.username as author',
        'universe.title as universe',
        'universe.shortname as universe_short',
      ])
      .select((eb) => eb.fn.count<number>('sc.id').as('chapter_count'))
      .select(sql<{ [chapterNumber: number]: { title: string, is_published: boolean, created_at: Date } }>`
        JSON_REMOVE(JSON_OBJECTAGG(
          IFNULL(sc.chapter_number, 'null__'),
          JSON_OBJECT('title', sc.title, 'is_published', sc.is_published, 'created_at', sc.created_at)
        ), '$.null__')
      `.as('chapters'))
      .select(sql<boolean>`MAX(sc.is_published)`.as('is_published'))
      .$if(user !== undefined, (qb) => qb.select(
        sql<boolean>`NOT ISNULL(au_filter.universe_id) AND story.drafts_public AND NOT au_filter.user_id = story.author_id`.as('shared'),
      ))
      .where((eb) => user
        ? eb.or([
          eb('sc.is_published', '=', true),
          eb('story.author_id', '=', user.id),
          eb.and([eb('story.drafts_public', '=', true), eb('au_filter.universe_id', 'is not', null)]),
        ])
        : eb('sc.is_published', '=', true))
      .$if(conditions !== null, (qb) => {
        let q = qb;
        for (const [key, value] of Object.entries(conditions ?? {})) {
          if (value === undefined) continue;
          q = q.where(kysely.dynamic.ref(key), '=', value);
        }
        return q;
      })
      .$if(options.search !== undefined && options.search !== '', (qb) => qb.where('story.title', 'like', `%${options.search}%`))
      .groupBy(['story.id', 'au_filter.user_id'])
      .orderBy(
        options.sort ? kysely.dynamic.ref(options.sort) : 'story.updated_at',
        options.sort ? (options.sortDesc ? 'desc' : 'asc') : 'desc',
      );

    const stories = await query.execute();
    return stories;
  }

  async getChapter(user: User | undefined, shortname: string, index: number, permissionsRequired = perms.READ): Promise<Chapter> {
    const story = await this.getOne(user, { 'story.shortname': shortname }, permissionsRequired);

    const chapter = await kysely
      .selectFrom('storychapter')
      .selectAll()
      .where('story_id', '=', story.id)
      .where('chapter_number', '=', index)
      .executeTakeFirst();
    if (!chapter) throw new NotFoundError();
    return { ...chapter, body: chapter.body as IndexedDocument | null };
  }

  async post(user: User | undefined, payload): Promise<{ insertId: number }> {
    if (!user) throw new UnauthorizedError();
    const { title, shortname, summary, is_public, universe: universeShort } = payload;
    if (!title) throw new ValidationError('Title is required.');
    if (!shortname) throw new ValidationError('Shortname is required.');
    if (!universeShort) throw new ValidationError('Universe is required.');
    if (typeof is_public !== 'boolean') throw new ValidationError('Draft visibility status is required.');

    const universe = await this.api.universe.getOne(user, { 'universe.shortname': universeShort }, perms.WRITE);

    try {
      const data = await kysely
        .insertInto('story')
        .values({
          title, shortname, summary: summary ?? null, drafts_public: is_public,
          author_id: user.id, universe_id: universe.id, created_at: new Date(), updated_at: new Date(),
        })
        .executeTakeFirstOrThrow();
      return { insertId: Number(data.insertId ?? 0) };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new ValidationError(`Shortname "${shortname}" already in use in this universe, please choose another.`);
      throw err;
    }
  }

  async postChapter(user: User | undefined, shortname: string, payload): Promise<[{ insertId: number }, number]> {
    if (!user) throw new UnauthorizedError();
    const { title, summary } = payload;
    if (!title) throw new ValidationError('Title is required.');

    const story = await this.getOne(user, { 'story.shortname': shortname }, perms.WRITE);

    const data = await kysely
      .insertInto('storychapter')
      .values({
        title, summary: summary ?? null, chapter_number: story.chapter_count + 1, body: null,
        story_id: story.id, created_at: new Date(), updated_at: new Date(),
      })
      .executeTakeFirstOrThrow();
    return [{ insertId: Number(data.insertId ?? 0) }, story.chapter_count + 1];
  }

  /**
   * This assumes we have write access to the provided story!
   */
  async reorderChapters(story, orderedIndexes) {
    const newIndexes = {};
    const ids = (await kysely
      .selectFrom('storychapter')
      .select(sql<{ [chapterNumber: number]: number }>`
        JSON_REMOVE(JSON_OBJECTAGG(IFNULL(chapter_number, 'null__'), id), '$.null__')
      `.as('ids'))
      .where('story_id', '=', story.id)
      .groupBy('story_id')
      .executeTakeFirst())?.ids!;

    await withTransaction(async (trx) => {
      await trx.updateTable('storychapter').set({ chapter_number: 0 }).where('story_id', '=', story.id).execute();
      for (let i = 0; i < orderedIndexes.length; i++) {
        const oldIndex = orderedIndexes[i];
        await trx.updateTable('storychapter').set({ chapter_number: i + 1 }).where('id', '=', ids[oldIndex]).execute();
        newIndexes[ids[oldIndex]] = i + 1;
      }
    });

    return newIndexes;
  }

  async put(user: User | undefined, storyShortname: string, payload): Promise<string> {
    if (!user) throw new UnauthorizedError();
    const { title, shortname, summary, drafts_public, order } = payload;

    const story = await this.getOne(user, { 'story.shortname': storyShortname }, perms.WRITE);

    if (order) {
      await this.reorderChapters(story, order);
    }
    if (title || shortname || summary || drafts_public) {
      await kysely
        .updateTable('story')
        .set({
          title: title ?? story.title,
          shortname: shortname ?? story.shortname,
          summary: summary ?? story.summary,
          drafts_public: drafts_public ?? story.drafts_public,
          updated_at: new Date(),
        })
        .where('id', '=', story.id)
        .execute();
    }
    return shortname ?? story.shortname;
  }

  async putChapter(user: User | undefined, shortname: string, index: number, payload: Partial<Chapter>): Promise<number> {
    if (!user) throw new UnauthorizedError();
    const { title, summary, body, is_published } = payload;

    const chapter = await this.getChapter(user, shortname, index, perms.WRITE);

    let publishDate: Date | null = null;
    if (is_published && !chapter.is_published) {
      publishDate = new Date();

      // We need to make sure published chapters are grouped together
      const story = await this.getOne(user, { 'story.shortname': shortname }, perms.WRITE);

      const published = Object.keys(story.chapters).reduce((acc, key) => ({ ...acc, [key]: story.chapters[key].is_published }), {});
      delete published[index];
      const publishedIndexes = Object.keys(published).filter(ch => published[ch]);
      const draftIndexes = Object.keys(published).filter(ch => !published[ch]);
      const indexes = [...publishedIndexes, index, ...draftIndexes];
      const newIndexes = await this.reorderChapters(story, indexes);
      index = newIndexes[chapter.id];
    }

    await withTransaction(async (trx) => {
      await trx
        .updateTable('storychapter')
        .set({
          title: title ?? chapter.title,
          summary: summary ?? chapter.summary,
          body: JSON.stringify(body ?? chapter.body),
          is_published: is_published ?? chapter.is_published,
          created_at: publishDate ?? chapter.created_at,
          updated_at: new Date(),
        })
        .where('id', '=', chapter.id)
        .execute();

      await trx.updateTable('story').set({ updated_at: new Date() }).where('id', '=', chapter.story_id).execute();
    });
    return index;
  }

  async del(user: User | undefined, shortname: string): Promise<void> {
    const story = await this.getOne(user, { 'story.shortname': shortname }, perms.OWNER);

    await withTransaction(async (trx) => {
      await sql`
        DELETE comment
        FROM comment
        INNER JOIN storychaptercomment AS scc ON scc.comment_id = comment.id
        INNER JOIN storychapter ON scc.chapter_id = storychapter.id
        WHERE storychapter.story_id = ${story.id}
      `.execute(trx);
      await trx.deleteFrom('story').where('id', '=', story.id).execute();
    });
  }

  async delChapter(user: User | undefined, shortname: string, index: number): Promise<void> {
    const chapter = await this.getChapter(user, shortname, index, perms.OWNER);

    await withTransaction(async (trx) => {
      await sql`
        DELETE comment
        FROM comment
        INNER JOIN storychaptercomment AS scc ON scc.comment_id = comment.id
        WHERE scc.chapter_id = ${chapter.id}
      `.execute(trx);
      await trx.deleteFrom('storychapter').where('id', '=', chapter.id).execute();
    });
    const story = await this.getOne(user, { 'story.shortname': shortname }, perms.OWNER);
    await this.reorderChapters(story, Object.keys(story.chapters).sort((a, b) => Number(a) - Number(b)));
  }
}
