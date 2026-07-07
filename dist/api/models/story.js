"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoryAPI = exports.StoryCoverAPI = void 0;
const utils_1 = require("../utils");
const errors_1 = require("../../errors");
const sharp_1 = __importDefault(require("sharp"));
class StoryCoverAPI {
    story;
    constructor(story) {
        this.story = story;
    }
    async getByShortname(user, shortname) {
        const story = await this.story.getOne(user, { 'story.shortname': shortname });
        if (!story)
            throw new errors_1.NotFoundError();
        let queryString = `
      SELECT
        si.story_id, image.id, image.name, image.mimetype, image.data
      FROM storyimage AS si
      INNER JOIN image ON image.id = si.image_id
      WHERE si.story_id = ?;
    `;
        const image = (await (0, utils_1.executeQuery)(queryString, [story.id]))[0];
        return image;
    }
    async post(user, file, shortname) {
        if (!file)
            throw new errors_1.ValidationError('No file provided');
        const { originalname, buffer, mimetype } = file;
        const story = await this.story.getOne(user, { 'story.shortname': shortname }, utils_1.perms.WRITE);
        const resizedBuffer = await (0, sharp_1.default)(buffer)
            .resize({
            width: 512,
            height: 800,
            fit: 'cover',
            withoutEnlargement: true
        })
            .jpeg({ quality: 80 })
            .toBuffer();
        let data;
        await (0, utils_1.withTransaction)(async (conn) => {
            await conn.execute(`
        DELETE image FROM image
        INNER JOIN storyimage AS ui ON ui.image_id = image.id
        WHERE ui.story_id = ?
      `, [story.id]);
            [data] = await conn.execute(`INSERT INTO image (name, mimetype, data) VALUES (?, ?, ?)`, [originalname.substring(0, 64), mimetype, resizedBuffer]);
            await conn.execute(`INSERT INTO storyimage (story_id, image_id) VALUES (?, ?)`, [story.id, data.insertId]);
        });
        return data;
    }
    async del(user, shortname) {
        const story = await this.story.getOne(user, { 'story.shortname': shortname }, utils_1.perms.WRITE);
        return await (0, utils_1.executeQuery)(`
      DELETE image FROM image
      INNER JOIN storyimage AS ui ON ui.image_id = image.id
      WHERE ui.story_id = ?
    `, [story.id]);
    }
}
exports.StoryCoverAPI = StoryCoverAPI;
class StoryAPI {
    cover;
    api;
    constructor(api) {
        this.cover = new StoryCoverAPI(this);
        this.api = api;
    }
    async getOne(user, conditions, permissionsRequired = utils_1.perms.READ, options = {}) {
        const stories = await this.getMany(user, conditions, permissionsRequired, options);
        const story = stories[0];
        if (!story)
            throw new errors_1.NotFoundError();
        return story;
    }
    async getMany(user, conditions = null, permissionsRequired = utils_1.perms.READ, options = {}) {
        if (permissionsRequired >= utils_1.perms.WRITE) {
            if (!user)
                throw new errors_1.UnauthorizedError();
            conditions = {
                ...(conditions ?? {}),
                'story.author_id': user.id,
            };
        }
        const parsedConditions = (0, utils_1.parseData)(conditions);
        if (options.search) {
            if (!conditions)
                conditions = {};
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
        const stories = await (0, utils_1.executeQuery)(`
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
      `, [...(user ? [user.id, utils_1.perms.WRITE, user.id] : []), ...parsedConditions?.values ?? []]);
        return stories;
    }
    async getChapter(user, shortname, index, permissionsRequired = utils_1.perms.READ) {
        const story = await this.getOne(user, { 'story.shortname': shortname }, permissionsRequired);
        const chapters = await (0, utils_1.executeQuery)('SELECT * FROM storychapter WHERE story_id = ? AND chapter_number = ?', [story.id, index]);
        const chapter = chapters[0];
        if (!chapter)
            throw new errors_1.NotFoundError();
        return chapter;
    }
    async post(user, payload) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const { title, shortname, summary, is_public, universe: universeShort } = payload;
        if (!title)
            throw new errors_1.ValidationError('Title is required.');
        if (!shortname)
            throw new errors_1.ValidationError('Shortname is required.');
        if (!universeShort)
            throw new errors_1.ValidationError('Universe is required.');
        if (typeof is_public !== 'boolean')
            throw new errors_1.ValidationError('Draft visibility status is required.');
        const universe = await this.api.universe.getOne(user, { 'universe.shortname': universeShort }, utils_1.perms.WRITE);
        try {
            const data = await (0, utils_1.executeQuery)(`
        INSERT INTO story (title, shortname, summary, drafts_public, author_id, universe_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [title, shortname, summary ?? null, is_public, user.id, universe.id, new Date(), new Date()]);
            return data;
        }
        catch (err) {
            if (err.code === 'ER_DUP_ENTRY')
                throw new errors_1.ValidationError(`Shortname "${shortname}" already in use in this universe, please choose another.`);
            throw err;
        }
    }
    async postChapter(user, shortname, payload) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const { title, summary } = payload;
        if (!title)
            throw new errors_1.ValidationError('Title is required.');
        const story = await this.getOne(user, { 'story.shortname': shortname }, utils_1.perms.WRITE);
        const data = await (0, utils_1.executeQuery)(`
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
        const ids = (await (0, utils_1.executeQuery)(`
      SELECT
        JSON_REMOVE(JSON_OBJECTAGG(
          IFNULL(chapter_number, 'null__'),
          id
        ), '$.null__') AS ids
      FROM storychapter
      WHERE story_id = ?
      GROUP BY story_id
    `, [story.id]))[0]?.ids;
        await (0, utils_1.withTransaction)(async (conn) => {
            await conn.execute('UPDATE storychapter SET chapter_number = 0 WHERE story_id = ?', [story.id]);
            for (let i = 0; i < orderedIndexes.length; i++) {
                const oldIndex = orderedIndexes[i];
                await conn.execute('UPDATE storychapter SET chapter_number = ? WHERE id = ?', [i + 1, ids[oldIndex]]);
                newIndexes[ids[oldIndex]] = i + 1;
            }
        });
        return newIndexes;
    }
    async put(user, storyShortname, payload) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const { title, shortname, summary, drafts_public, order } = payload;
        const story = await this.getOne(user, { 'story.shortname': storyShortname }, utils_1.perms.WRITE);
        if (order) {
            await this.reorderChapters(story, order);
        }
        if (title || shortname || summary || drafts_public) {
            await (0, utils_1.executeQuery)(`
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
    async putChapter(user, shortname, index, payload) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const { title, summary, body, is_published } = payload;
        const chapter = await this.getChapter(user, shortname, index, utils_1.perms.WRITE);
        let publishDate = null;
        if (is_published && !chapter.is_published) {
            publishDate = new Date();
            // We need to make sure published chapters are grouped together
            const story = await this.getOne(user, { 'story.shortname': shortname }, utils_1.perms.WRITE);
            const published = Object.keys(story.chapters).reduce((acc, key) => ({ ...acc, [key]: story.chapters[key].is_published }), {});
            delete published[index];
            const publishedIndexes = Object.keys(published).filter(ch => published[ch]);
            const draftIndexes = Object.keys(published).filter(ch => !published[ch]);
            const indexes = [...publishedIndexes, index, ...draftIndexes];
            const newIndexes = await this.reorderChapters(story, indexes);
            index = newIndexes[chapter.id];
        }
        await (0, utils_1.withTransaction)(async (conn) => {
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
    async del(user, shortname) {
        const story = await this.getOne(user, { 'story.shortname': shortname }, utils_1.perms.OWNER);
        await (0, utils_1.withTransaction)(async (conn) => {
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
    async delChapter(user, shortname, index) {
        const chapter = await this.getChapter(user, shortname, index, utils_1.perms.OWNER);
        await (0, utils_1.withTransaction)(async (conn) => {
            await conn.execute(`
          DELETE comment
          FROM comment
          INNER JOIN storychaptercomment AS scc ON scc.comment_id = comment.id
          WHERE scc.chapter_id = ?;
        `, [chapter.id]);
            await conn.execute(`DELETE FROM storychapter WHERE id = ?;`, [chapter.id]);
        });
        const story = await this.getOne(user, { 'story.shortname': shortname }, utils_1.perms.OWNER);
        await this.reorderChapters(story, Object.keys(story.chapters).sort((a, b) => Number(a) - Number(b)));
    }
}
exports.StoryAPI = StoryAPI;
