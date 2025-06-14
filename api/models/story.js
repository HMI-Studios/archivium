const { executeQuery, parseData, perms, withTransaction } = require('../utils');
const logger = require('../../logger');

let api;
function setApi(_api) {
  api = _api;
}

async function getOne(user, conditions, permissionsRequired=perms.READ, options={}) {
  const [code, stories] = await getMany(user, conditions, permissionsRequired, options);
  if (!stories) return [code];
  const story = stories[0];
  if (!story) return [404];
  return [200, story];
}

async function getMany(user, conditions, permissionsRequired=perms.READ, options={}) {
  if (permissionsRequired >= perms.WRITE) {
    if (!user) return [401];
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

  try {
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
    `, [ ...(user ? [user.id, perms.WRITE, user.id] : []), ...parsedConditions?.values ?? [] ]);
    return [200, stories];
  } catch (err) {
    logger.error(err);
    return [500];
  }
}

async function getChapter(user, shortname, index, permissionsRequired=perms.READ) {
  const [code, story] = await getOne(user, { 'story.shortname': shortname }, permissionsRequired);
  if (!story) return [code];

  try {
    const chapters = await executeQuery('SELECT * FROM storychapter WHERE story_id = ? AND chapter_number = ?', [story.id, index]);
    const chapter = chapters[0];
    if (!chapter) return [404];
    return [200, chapter];
  } catch (err) {
    logger.error(err);
    return [500];
  }
}

async function post(user, payload) {
  if (!user) return [401];
  const { title, shortname, summary, public, universe: universeShort } = payload;
  if (!title) return [400, 'Title is required.'];
  if (!shortname) return [400, 'Shortname is required.'];
  if (!universeShort) return [400, 'Universe is required.'];
  if (typeof public !== 'boolean') return [400, 'Draft visibility status is required.'];

  const [code, universe] = await api.universe.getOne(user, { 'universe.shortname': universeShort }, perms.WRITE);
  if (!universe) return [code];

  try {
    const data = await executeQuery(`
      INSERT INTO story (title, shortname, summary, drafts_public, author_id, universe_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [title, shortname, summary ?? null, public, user.id, universe.id, new Date(), new Date()]);
    return [201, data];
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return [400, `Shortname "${shortname}" already in use in this universe, please choose another.`];
    logger.error(err);
    return [500];
  }
}

async function postChapter(user, shortname, payload) {
  if (!user) return [401];
  const { title, summary } = payload;
  if (!title) return [400, 'Title is required.'];

  const [code, story] = await getOne(user, { 'story.shortname': shortname }, perms.WRITE);
  if (!story) return [code];

  try {
    const data = await executeQuery(`
      INSERT INTO storychapter (title, summary, chapter_number, body, story_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [title, summary ?? null, story.chapter_count + 1, '', story.id, new Date(), new Date()]);
    return [201, data, story.chapter_count + 1];
  } catch (err) {
    logger.error(err);
    return [500];
  }
}

/**
 * This assumes we have write access to the provided story!
 */
async function reorderChapters(story, orderedIndexes) {
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
  `, [story.id]))[0].ids;

  await withTransaction(async (conn) => {
    await conn.execute('UPDATE storychapter SET chapter_number = 0 WHERE story_id = ?', [story.id]);
    for (let i = 0; i < orderedIndexes.length; i++) {
      const oldIndex = orderedIndexes[i];
      await conn.execute('UPDATE storychapter SET chapter_number = ? WHERE id = ?', [i+1, ids[oldIndex]]);
      newIndexes[ids[oldIndex]] = i + 1;
    }
  });

  return newIndexes;
}

async function put(user, storyShortname, payload) {
  if (!user) return [401];
  const { title, shortname, summary, drafts_public, order } = payload;

  const [code, story] = await getOne(user, { 'story.shortname': storyShortname }, perms.WRITE);
  if (!story) return [code];

  try {
    if (order) {
      await reorderChapters(story, order);
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
    return [200, shortname ?? story.shortname];
  } catch (err) {
    logger.error(err);
    return [500];
  }
}

async function putChapter(user, shortname, index, payload) {
  if (!user) return [401];
  const { title, summary, body, is_published } = payload;

  const [code, chapter] = await getChapter(user, shortname, index, perms.WRITE);
  if (!chapter) return [code];

  let publishDate = null;
  if (is_published && !chapter.is_published) {
    publishDate = new Date();

    // We need to make sure published chapters are grouped together
    const [code, story] = await getOne(user, { 'story.shortname': shortname }, perms.WRITE);
    if (!story) return [code];
    
    const published = Object.keys(story.chapters).reduce((acc, key) => ({ ...acc, [key]: story.chapters[key].is_published }), {});
    delete published[index];
    const publishedIndexes = Object.keys(published).filter(ch => published[ch]);
    const draftIndexes = Object.keys(published).filter(ch => !published[ch]);
    const indexes = [...publishedIndexes, index, ...draftIndexes];
    const newIndexes = await reorderChapters(story, indexes);
    index = newIndexes[chapter.id];
  }

  try {
    await executeQuery(`
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
    return [200, index];
  } catch (err) {
    logger.error(err);
    return [500];
  }
}

async function del(user, shortname) {
  const [code, story] = await getOne(user, { 'story.shortname': shortname }, perms.OWNER);
  if (!story) return [code];
  
  try {
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
    return [200];
  } catch (err) {
    logger.error(err);
    return [500, 'Error: could not delete story.'];
  }
}

async function delChapter(user, shortname, index) {
  const [code, chapter] = await getChapter(user, shortname, index, perms.OWNER);
  if (!chapter) return [code];
  
  try {
    await withTransaction(async (conn) => {
      await conn.execute(`
        DELETE comment
        FROM comment
        INNER JOIN storychaptercomment AS scc ON scc.comment_id = comment.id
        WHERE scc.chapter_id = ?;
      `, [chapter.id]);
      await conn.execute(`DELETE FROM storychapter WHERE id = ?;`, [chapter.id]);
    });
    const [code, story] = await getOne(user, { 'story.shortname': shortname }, perms.OWNER);
    if (!story) throw new Error(`Fatal errror: story.getOne returned code ${code} after chapter deletion!`);
    await reorderChapters(story, Object.keys(story.chapters).sort((a, b) => a - b));
    return [200];
  } catch (err) {
    logger.error(err);
    return [500, 'Error: could not delete chapter.'];
  }
}

module.exports = {
  setApi,
  getOne,
  getMany,
  getChapter,
  post,
  postChapter,
  put,
  putChapter,
  del,
  delChapter,
};
