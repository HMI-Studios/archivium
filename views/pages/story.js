const { ADDR_PREFIX } = require('../../config');
const api = require('../../api');
const { universeLink } = require('../../templates');
const { perms, getPfpUrl } = require('../../api/utils');
const logger = require('../../logger');
const { T } = require('../../locale');

module.exports = {
  async list(req, res) {
    const search = req.query.search;
    const [code, stories] = await api.story.getMany(
      req.session.user,
      null,
      perms.READ,
      {
        sort: req.query.sort,
        sortDesc: req.query.sort_order === 'desc',
        search,
      },
    );
    res.status(code);
    if (!stories) return;
    res.prepareRender('storyList', { stories, search });
  },

  async create(req, res) {
    const [code, universes] = await api.universe.getMany(req.session.user, null, perms.WRITE);
    res.status(code);
    if (code !== 200) return;
    res.prepareRender('createStory', { universes });
  },
  
  async view(req, res) {
    const [code, story] = await api.story.getOne(req.session.user, { 'story.shortname': req.params.shortname });
    res.status(code);
    if (!story) return;
    res.prepareRender('story', { story });
  },

  async delete(req, res) {
    const [code, story] = await api.story.getOne(req.session.user, { 'story.shortname': req.params.shortname }, perms.OWNER);
    res.status(code);
    if (!story) return res.redirect(`${ADDR_PREFIX}/stories`);
    res.prepareRender('deleteStory', { story });
  },

  async edit(req, res, error, body) {
    const [code, fetchedStory] = await api.story.getOne(req.session.user, { 'story.shortname': req.params.shortname }, perms.WRITE);
    res.status(code);
    if (!fetchedStory) return;
    const story = {...fetchedStory, ...(body ?? {}), shortname: fetchedStory.shortname, newShort: body?.shortname ?? fetchedStory.shortname};
    res.prepareRender('editStory', { story, error });
  },

  async createChapter(req, res) {
    const [code, story] = await api.story.getOne(req.session.user, { 'story.shortname': req.params.shortname });
    res.status(code);
    if (!story) return;

    const title = `${T('Untitled Chapter')} ${story.chapter_count + 1}`;
    const [code2, data, index] = await api.story.postChapter(req.session.user, story.shortname, { title });
    res.status(code2);
    if (!data) return;
    return res.redirect(`${ADDR_PREFIX}/stories/${story.shortname}/${index}/edit`);
  },
  
  async viewChapter(req, res) {
    const [code1, story] = await api.story.getOne(req.session.user, { 'story.shortname': req.params.shortname });
    res.status(code1);
    if (!story) return;
    const [code2, chapter] = await api.story.getChapter(req.session.user, story.shortname, req.params.index);
    res.status(code2);
    if (!chapter) return;
    const [code3, comments, commentUsers] = await api.discussion.getCommentsByChapter(chapter.id, true);
    if (!comments || !commentUsers) return res.status(code3);
    const commenters = {};
    for (const user of commentUsers) {
      user.pfpUrl = getPfpUrl(user);
      delete user.email;
      commenters[user.id] = user;
    }
    res.prepareRender('chapter', {
      story, chapter, comments, commenters,
      commentAction: `${ADDR_PREFIX}/stories/${story.shortname}/${chapter.chapter_number}/comment`,
    });
  },

  async deleteChapter(req, res) {
    const [code, chapter] = await api.story.getChapter(req.session.user, req.params.shortname, req.params.index, perms.OWNER);
    res.status(code);
    if (!chapter) return res.redirect(`${ADDR_PREFIX}/stories/${req.params.shortname}`);
    chapter.storyShort = req.params.shortname;
    res.prepareRender('deleteChapter', { chapter });
  },

  async editChapter(req, res, error, body) {
    const [code1, story] = await api.story.getOne(req.session.user, { 'story.shortname': req.params.shortname }, perms.WRITE);
    res.status(code1);
    if (!story) return;
    const [code2, fetchedChapter] = await api.story.getChapter(req.session.user, req.params.shortname, req.params.index, perms.WRITE);
    res.status(code2);
    if (!fetchedChapter) return;
    const chapter = { ...fetchedChapter, ...(body ?? {}) };
    res.prepareRender('editChapter', { story, chapter, error });
  },
};
