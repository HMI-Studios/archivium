import { ADDR_PREFIX } from '../../config';
import api from '../../api';
import { universeLink } from '../../templates';
import { perms, getPfpUrl, tierAllowance, tierLimits } from '../../api/utils';
import logger from '../../logger';
import { RouteHandler } from '..';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../errors';
import { Comment } from '../../api/models/discussion';
import { User } from '../../api/models/user';

export default {
  async list(req, res) {
    const search = req.query.search;
    const universes = await api.universe.getMany(
      req.session.user,
      search ? { strings: ['title LIKE ?'], values: [`%${search}%`] } : null,
      perms.READ,
      {
        sort: req.query.sort as string,
        sortDesc: req.query.sort_order === 'desc',
      },
    );
    res.prepareRender('universeList', { universes, search, layout: req.query.layout });
  },

  async create(_, res) {
    res.prepareRender('createUniverse');
  },

  async view(req, res) {
    const user = req.session.user;
    const accessRequest = await api.universe.getUserAccessRequestIfExists(user, req.params.universeShortname).catch(() => null);
    try {
      const universe = await api.universe.getOne(user, { shortname: req.params.universeShortname });
      const authors = await api.user.getByUniverseShortname(user, universe.shortname);
      const authorMap = {};
      authors.forEach(author => {
        authorMap[author.id] = {
          ...author,
          pfpUrl: getPfpUrl(author),
        };
      });
      const threads = await api.discussion.getThreads(user, { 'discussion.universe_id': universe.id }, false, true);
      const [counts, totalItems] = await api.item.getCountsByUniverse(user, universe, false);
      const stories = await api.story.getMany(user, { 'story.universe_id': universe.id });
      const sponsored = user ? await api.user.getSponsoredUniverses(user) : null;
      const couldUpgrade = sponsored ? (
        sponsored.length === 0 || sponsored
          .filter(row => row.tier > (universe.tier ?? 0))
          // .some(row => row.universes.length < tierAllowance[user.plan][row.tier])
      ) : false;
      res.prepareRender('universe', { universe, authors: authorMap, threads, counts, totalItems, stories, couldUpgrade, accessRequest });
    } catch (err) {
      // If the user is not authorized to view the universe, check if there is a public page to display instead
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
        const publicBody = await api.universe.getPublicBodyByShortname(req.params.universeShortname);
        if (!publicBody && err instanceof UnauthorizedError) {
          res.status(401);
          req.forceLogin = true;
          // req.useExQuery = true; // TODO why is this here?
          return;
        }
        return res.prepareRender('privateUniverse', { shortname: req.params.universeShortname, accessRequest, publicBody });
      }
      throw err;
    }
  },

  async delete(req, res) {
    try {
      const universe = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, perms.OWNER);
      res.prepareRender('deleteUniverse', { universe });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.redirect(`${ADDR_PREFIX}/universes`);
      }
      throw err;
    }
  },

  async edit(req, res) {
    const fetchedUniverse = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, perms.WRITE);
    const universe = {...fetchedUniverse, ...(req.body ?? {}), shortname: fetchedUniverse.shortname, newShort: req.body?.shortname ?? fetchedUniverse.shortname};
    res.prepareRender('editUniverse', { universe, error: res.error });
  },

  async createDiscussionThread(req, res) {
    if (!req.session.user) throw new UnauthorizedError();
    const universe = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, perms.READ);
    if (!universe.discussion_enabled || !universe.discussion_open && universe.author_permissions[req.session.user.id] < perms.COMMENT) {
      throw new ForbiddenError();
    }
    res.prepareRender('createUniverseThread', { universe });
  },

  async discussionThread(req, res) {
    const universe = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname });
    const threads = await api.discussion.getThreads(req.session.user, {
      'discussion.id': req.params.threadId,
      'universe.id': universe.id,
    });
    if (threads.length === 0) throw new NotFoundError();
    const thread = threads[0];
    const [comments, users] = await api.discussion.getCommentsByThread(req.session.user, thread.id, false, true) as [Comment[], User[]];
    const commenters = {};
    for (const user of users) {
      user.pfpUrl = getPfpUrl(user);
      delete user.email;
      commenters[user.id] = user;
    }

    res.prepareRender('universeThread', {
      universe, thread, comments, commenters,
      commentAction: `${universeLink(req, universe.shortname)}/discuss/${thread.id}/comment`,
    });
  },

  async itemList(req, res) {
    const search = req.getQueryParam('search');
    const universe = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname });
    const items = await api.item.getByUniverseShortname(req.session.user, req.params.universeShortname, perms.READ, {
      sort: req.getQueryParam('sort'),
      sortDesc: req.getQueryParam('sort_order') === 'desc',
      limit: req.getQueryParamAsNumber('limit'),
      type: req.getQueryParam('type'),
      tag: req.getQueryParam('tag'),
      author: req.getQueryParam('author'),
      search,
    });
    res.prepareRender('universeItemList', {
      items: items.map(item => ({ ...item, itemTypeName: ((universe.obj_data['cats'] ?? {})[item.item_type] ?? ['Missing Category'])[0] })),
      universe,
      type: req.query.type,
      tag: req.query.tag,
      search,
      layout: req.query.layout,
    });
  },

  async admin(req, res) {
    const universe = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, perms.ADMIN);

    const requests = await api.universe.getAccessRequests(req.session.user, req.params.universeShortname);
    const invites = await api.universe.getAccessInvites(req.session.user, req.params.universeShortname);
    let ownerCount = 0;
    for (const userID in universe.author_permissions) {
      if (universe.author_permissions[userID] === perms.OWNER) ownerCount++;
    }

    const totalStoredImages = await api.universe.getTotalStoredByShortname(universe.shortname);

    res.prepareRender('universeAdmin', { universe, requests, invites, ownerCount, totalStoredImages, tierLimits: tierLimits[universe.tier ?? 0] });
  },

  async upgrade(req, res) {
    const universe = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, perms.ADMIN);
    const sponsoredData = await api.user.getSponsoredUniverses(req.session.user);
    const sponsored = sponsoredData.reduce((acc, row) => ({ ...acc, [row.tier]: row.universes.length }), {});
    res.prepareRender('upgradeUniverse', { universe, sponsored });
  },
} satisfies Record<string, RouteHandler>;
