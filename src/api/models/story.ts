import { BaseOptions, executeQuery, parseData, perms, withTransaction } from '../utils';
import { API } from '..';
import { User } from './user';
import { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../errors';
import { IndexedDocument } from '../../lib/tiptapHelpers';
import sharp from 'sharp';

export type StoryCover = {
  user_id: number,
  id: number,
  name: string,
  mimetype: string,
  data: Buffer,
};

export type Story = {
  id: number,
  title: string,
  shortname: string,
  summary: string,
  drafts_public: boolean,
  author_id: number,
  universe_id: number,
  created_at: Date,
  updated_at: Date,
  author: string,
  chapter_count: number,
  chapters: { title: string, is_published: boolean, created_at: Date },
  universe: string,
  universe_short: string,
  is_published: boolean,
  shared?: boolean,
};

export type Chapter = {
  id: number,
  title: string,
  summary: string,
  chapter_number: number,
  body: IndexedDocument,
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
    let queryString = `
      SELECT
        si.story_id, image.id, image.name, image.mimetype, image.data
      FROM storyimage AS si
      INNER JOIN image ON image.id = si.image_id
      WHERE si.story_id = ?;
    `;
    const image = (await executeQuery(queryString, [story.id]))[0] as StoryCover | undefined;
    return image;
  }

  async post(user: User | undefined, file: Express.Multer.File | undefined, shortname: string): Promise<ResultSetHeader> {
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

    let data!: ResultSetHeader;
    await withTransaction(async (conn: PoolConnection) => {
      await conn.execute(`
        DELETE image FROM image
        INNER JOIN storyimage AS ui ON ui.image_id = image.id
        WHERE ui.story_id = ?
      `, [story.id]);

      [data] = await conn.execute<ResultSetHeader>(
        `INSERT INTO image (name, mimetype, data) VALUES (?, ?, ?)`,
        [originalname.substring(0, 64), mimetype, resizedBuffer],
      );

      await conn.execute<ResultSetHeader>(
        `INSERT INTO storyimage (story_id, image_id) VALUES (?, ?)`,
        [story.id, data.insertId],
      );
    });
    return data;
  }

  async del(user: User | undefined, shortname: string): Promise<ResultSetHeader> {
    const story = await this.story.getOne(user, { 'story.shortname': shortname }, perms.WRITE);
    return await executeQuery<ResultSetHeader>(`
      DELETE image FROM image
      INNER JOIN storyimage AS ui ON ui.image_id = image.id
      WHERE ui.story_id = ?
    `, [story.id]);
  }
}

export class StoryAPI {
  readonly cover: StoryCoverAPI;
  readonly api: API;

  constructor(api: API) {
    this.cover = new StoryCoverAPI(this);
    this.api = api;
  }

  async getOne(user, conditions, permissionsRequired = perms.READ, options = {}): Promise<Story> {
    const stories = await this.getMany(user, conditions, permissionsRequired, options);
    const story = stories[0];
    if (!story) throw new NotFoundError();
    return story;
  }

  async getMany(user, conditions: any = null, permissionsRequired = perms.READ, options: BaseOptions = {}): Promise<Story[]> {
    if (permissionsRequired >= perms.WRITE) {
      if (!user) throw new UnauthorizedError();
      conditions = {
        ...(conditions ?? {}),
        'story.author_id': user.id,
      };
    }

    const parsedConditions = parseData(conditions);
    if (options.search) {
      if (!conditions) conditions = {};
      parsedConditions.strings.push('story.title LIKE ?');
      parsedConditions.values.push(`%${options.search}%`);
    }
    const conditionString = conditions ? `AND ${parsedConditions.strings.join(' AND ')}` : '';

    if (options.sort && !options.forceSort) {
      const validSorts = { 'title': true, 'created_at': true, 'updated_at': true, 'author': true };
      if (!validSorts[options.sort]) {
        delete options.sort;
      }
    }

    const stories = await executeQuery(`
        SELECT
          story.*,
          author.username AS author,
          COUNT(sc.id) AS chapter_count,
          JSON_REMOVE(JSON_OBJECTAGG(
            IFNULL(sc.chapter_number, 'null__'),
            JSON_OBJECT('title', sc.title, 'is_published', sc.is_published, 'created_at', sc.created_at)
          ), '$.null__') AS chapters,
          universe.title AS universe,
          universe.shortname AS universe_short,
          MAX(sc.is_published) AS is_published
          ${user ? `,
          NOT ISNULL(au_filter.universe_id) AND story.drafts_public AND NOT au_filter.user_id = story.author_id AS shared
          ` : ''}
        FROM story
        LEFT JOIN storychapter AS sc ON sc.story_id = story.id
        INNER JOIN user AS author ON author.id = story.author_id
        INNER JOIN universe ON universe.id = story.universe_id
        ${user ? `
        LEFT JOIN authoruniverse AS au_filter
          ON universe.id = au_filter.universe_id
          AND au_filter.user_id = ?
          AND au_filter.permission_level >= ?
        ` : ''}
        WHERE (is_published ${user ? `OR story.author_id = ? OR (story.drafts_public AND au_filter.universe_id IS NOT NULL)` : ''})
        ${conditionString}
        GROUP BY story.id${user ? ', au_filter.user_id' : ''}
        ORDER BY ${options.sort ? `${options.sort} ${options.sortDesc ? 'DESC' : 'ASC'}` : 'updated_at DESC'}
      `, [...(user ? [user.id, perms.WRITE, user.id] : []), ...parsedConditions?.values ?? []]) as Story[];
    return stories;
  }

  async getChapter(user: User | undefined, shortname: string, index: number, permissionsRequired = perms.READ): Promise<Chapter> {
    const story = await this.getOne(user, { 'story.shortname': shortname }, permissionsRequired);

    const chapters = await executeQuery('SELECT * FROM storychapter WHERE story_id = ? AND chapter_number = ?', [story.id, index]) as Chapter[];
    const chapter = chapters[0];
    if (!chapter) throw new NotFoundError();
    return chapter;
  }

  async post(user: User | undefined, payload): Promise<ResultSetHeader> {
    if (!user) throw new UnauthorizedError();
    const { title, shortname, summary, is_public, universe: universeShort } = payload;
    if (!title) throw new ValidationError('Title is required.');
    if (!shortname) throw new ValidationError('Shortname is required.');
    if (!universeShort) throw new ValidationError('Universe is required.');
    if (typeof is_public !== 'boolean') throw new ValidationError('Draft visibility status is required.');

    const universe = await this.api.universe.getOne(user, { 'universe.shortname': universeShort }, perms.WRITE);

    try {
      const data = await executeQuery<ResultSetHeader>(`
        INSERT INTO story (title, shortname, summary, drafts_public, author_id, universe_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [title, shortname, summary ?? null, is_public, user.id, universe.id, new Date(), new Date()]);
      return data;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new ValidationError(`Shortname "${shortname}" already in use in this universe, please choose another.`);
      throw err;
    }
  }

  async postChapter(user: User | undefined, shortname: string, payload): Promise<[ResultSetHeader, number]> {
    if (!user) throw new UnauthorizedError();
    const { title, summary } = payload;
    if (!title) throw new ValidationError('Title is required.');

    const story = await this.getOne(user, { 'story.shortname': shortname }, perms.WRITE);

    const data = await executeQuery<ResultSetHeader>(`
        INSERT INTO storychapter (title, summary, chapter_number, body, story_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [title, summary ?? null, story.chapter_count + 1, null, story.id, new Date(), new Date()]);
    return [data, story.chapter_count + 1];
  }

  /**
   * This assumes we have write access to the provided story!
   */
  async reorderChapters(story, orderedIndexes) {
    const newIndexes = {};
    const ids = (await executeQuery(`
      SELECT
        JSON_REMOVE(JSON_OBJECTAGG(
          IFNULL(chapter_number, 'null__'),
          id
        ), '$.null__') AS ids
      FROM storychapter
      WHERE story_id = ?
      GROUP BY story_id
    `, [story.id]))[0]?.ids;

    await withTransaction(async (conn) => {
      await conn.execute('UPDATE storychapter SET chapter_number = 0 WHERE story_id = ?', [story.id]);
      for (let i = 0; i < orderedIndexes.length; i++) {
        const oldIndex = orderedIndexes[i];
        await conn.execute('UPDATE storychapter SET chapter_number = ? WHERE id = ?', [i + 1, ids[oldIndex]]);
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
      await executeQuery(`
          UPDATE story
          SET
            title = ?,
            shortname = ?,
            summary = ?,
            drafts_public = ?,
            updated_at = ?
          WHERE id = ?
        `, [title ?? story.title, shortname ?? story.shortname, summary ?? story.summary, drafts_public ?? story.drafts_public, new Date(), story.id]);
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

    await withTransaction(async (conn) => {
      await conn.execute(`
          UPDATE storychapter
          SET
            title = ?,
            summary = ?,
            body = ?,
            is_published = ?,
            created_at = ?,
            updated_at = ?
          WHERE id = ?
        `, [title ?? chapter.title, summary ?? chapter.summary, body ?? chapter.body, is_published ?? chapter.is_published, publishDate ?? chapter.created_at, new Date(), chapter.id]);

        await conn.execute('UPDATE story SET updated_at = ? WHERE id = ?', [new Date(), chapter.story_id]);
    });
    return index;
  }

  async del(user: User | undefined, shortname: string): Promise<void> {
    const story = await this.getOne(user, { 'story.shortname': shortname }, perms.OWNER);

    await withTransaction(async (conn) => {
      await conn.execute(`
          DELETE comment
          FROM comment
          INNER JOIN storychaptercomment AS scc ON scc.comment_id = comment.id
          INNER JOIN storychapter ON scc.chapter_id = storychapter.id
          WHERE storychapter.story_id = ?;
        `, [story.id]);
      await conn.execute(`DELETE FROM story WHERE id = ?;`, [story.id]);
    });
  }

  async delChapter(user: User | undefined, shortname: string, index: number): Promise<void> {
    const chapter = await this.getChapter(user, shortname, index, perms.OWNER);

    await withTransaction(async (conn) => {
      await conn.execute(`
          DELETE comment
          FROM comment
          INNER JOIN storychaptercomment AS scc ON scc.comment_id = comment.id
          WHERE scc.chapter_id = ?;
        `, [chapter.id]);
      await conn.execute(`DELETE FROM storychapter WHERE id = ?;`, [chapter.id]);
    });
    const story = await this.getOne(user, { 'story.shortname': shortname }, perms.OWNER);
    await this.reorderChapters(story, Object.keys(story.chapters).sort((a, b) => Number(a) - Number(b)));
  }
}
