import { RouteHandler } from '..';
import api from '../../api';
import { Comment } from '../../api/models/discussion';
import { BasicUser, User } from '../../api/models/user';
import { getPfpUrl, perms } from '../../api/utils';
import { ADDR_PREFIX } from '../../config';
import { NotFoundError } from '../../errors';
import { RenderedBody, tryRenderContent } from '../../lib/renderContent';
import { T } from '../../locale';

export default {
  async list(req, res) {
    const search = req.getQueryParam('search');
    const stories = await api.story.getMany(
      req.session.user,
      null,
      perms.READ,
      {
        sort: req.getQueryParam('sort'),
        sortDesc: req.getQueryParam('sort_order') === 'desc',
        search,
      },
    );
    res.prepareRender('storyList', { stories, search });
  },

  async create(req, res) {
    const universes = await api.universe.getMany(req.session.user, null, perms.WRITE);
    res.prepareRender('createStory', { universes });
  },
  
  async view(req, res) {
    const story = await api.story.getOne(req.session.user, { 'story.shortname': req.params.shortname });
    res.prepareRender('story', { story });
  },

  async delete(req, res) {
    try {
      const story = await api.story.getOne(req.session.user, { 'story.shortname': req.params.shortname }, perms.OWNER);
      res.prepareRender('deleteStory', { story });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.redirect(`${ADDR_PREFIX}/stories`);
      }
      throw err;
    }
  },

  async edit(req, res) {
    const fetchedStory = await api.story.getOne(req.session.user, { 'story.shortname': req.params.shortname }, perms.WRITE);
    const story = {...fetchedStory, ...(req.body ?? {}), shortname: fetchedStory.shortname, newShort: req.body?.shortname ?? fetchedStory.shortname};
    res.prepareRender('editStory', { story, error: res.error });
  },

  async createChapter(req, res) {
    const story = await api.story.getOne(req.session.user, { 'story.shortname': req.params.shortname });

    const title = `${T('Untitled Chapter')} ${story.chapter_count + 1}`;
    const [, index] = await api.story.postChapter(req.session.user, story.shortname, { title });
    return res.redirect(`${ADDR_PREFIX}/editor/stories/${story.shortname}/${index}`);
  },
  
  async viewChapter(req, res) {
    const story = await api.story.getOne(req.session.user, { 'story.shortname': req.params.shortname });
    const chapter = await api.story.getChapter(req.session.user, story.shortname, Number(req.params.index));
    const [comments, commentUsers] = await api.discussion.getCommentsByChapter(chapter.id, true) as [Comment[], User[]];
    const commenters: { [id: number]: BasicUser } = {};
    for (const user of commentUsers) {
      user.pfpUrl = getPfpUrl(user);
      commenters[user.id] = api.user.toBasicUser(user);
    }

    let renderedBody: RenderedBody = await tryRenderContent(req, chapter.body, story.universe_short);

    res.prepareRender('chapter', {
      story, chapter, comments, commenters, renderedBody,
      commentAction: `${ADDR_PREFIX}/stories/${story.shortname}/${chapter.chapter_number}/comment`,
    });
  },

  async deleteChapter(req, res) {
    try {
      const chapter = await api.story.getChapter(req.session.user, req.params.shortname, Number(req.params.index), perms.OWNER);
      res.prepareRender('deleteChapter', { chapter, storyShort: req.params.shortname });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.redirect(`${ADDR_PREFIX}/stories/${req.params.shortname}`);
      }
      throw err;
    }
  },
} satisfies Record<string, RouteHandler>;
