const { ADDR_PREFIX } = require('../../config');
const api = require('../../api');
const { universeLink } = require('../../templates');
const { perms, getPfpUrl } = require('../../api/utils');
const logger = require('../../logger');

module.exports = {
  async list(req, res) {
    const search = req.query.search;
    const [code, universes] = await api.universe.getMany(
      req.session.user,
      search ? { strings: ['title LIKE ?'], values: [`%${search}%`] } : null,
      perms.READ,
      {
        sort: req.query.sort,
        sortDesc: req.query.sort_order === 'desc',
      },
    );
    res.status(code);
    if (!universes) return;
    res.prepareRender('universeList', { universes, search });
  },
  
  async create(_, res) {
    res.prepareRender('createUniverse');
  },
  
  async view(req, res) {
    const [code1, universe] = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname });
    res.status(code1);
    if (code1 === 403 || code1 === 401) {
      const [code, publicBody] = await api.universe.getPublicBodyByShortname(req.params.universeShortname);
      if (!publicBody && code1 === 401) {
        res.status(code);
        req.forceLogin = true;
        req.useExQuery = true;
        return;
      }
      res.status(200);
      const [, request] = await api.universe.getUserAccessRequest(req.session.user, req.params.universeShortname);
      return res.prepareRender('privateUniverse', { shortname: req.params.universeShortname, hasRequested: Boolean(request), publicBody });
    }
    else if (!universe) return;
    const [code2, authors] = await api.user.getByUniverseShortname(req.session.user, universe.shortname);
    res.status(code2);
    if (!authors) return;
    const authorMap = {};
    authors.forEach(author => {
      authorMap[author.id] = {
        ...author,
        pfpUrl: getPfpUrl(author),
      };
    });
    const [code3, threads] = await api.discussion.getThreads(req.session.user, { 'discussion.universe_id': universe.id }, false, true);
    if (!threads) return res.status(code3);
    const [code4, counts] = await api.item.getCountsByUniverse(req.session.user, universe, false);
    if (!counts) return res.status(code4);
    const [code5, stories] = await api.story.getMany(req.session.user, { 'story.universe_id': universe.id });
    if (!stories) return res.status(code5);
    res.prepareRender('universe', { universe, authors: authorMap, threads, counts, stories });
  },

  async delete(req, res) {
    const [code, universe] = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, perms.OWNER);
    res.status(code);
    if (!universe) return res.redirect(`${ADDR_PREFIX}/universes`);
    res.prepareRender('deleteUniverse', { universe });
  },

  async edit(req, res, error, body) {
    const [code, fetchedUniverse] = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, perms.WRITE);
    res.status(code);
    if (!fetchedUniverse) return;
    const universe = {...fetchedUniverse, ...(body ?? {}), shortname: fetchedUniverse.shortname, newShort: body?.shortname ?? fetchedUniverse.shortname};
    res.prepareRender('editUniverse', { universe, error });
  },
 
  async createDiscussionThread(req, res) {
    const [code, universe] = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, perms.READ);
    if (!universe) return res.status(code);
    if (!universe.discussion_enabled) return res.status(403);
    if (!universe.discussion_open && universe.author_permissions[req.session.user.id] < perms.COMMENT) return res.status(403);
    res.status(code);
    if (code !== 200) return;
    res.prepareRender('createUniverseThread', { universe });
  },
  
  async discussionThread(req, res) {
    const [code1, universe] = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname });
    res.status(code1);
    if (code1 !== 200) return;
    const [code2, threads] = await api.discussion.getThreads(req.session.user, {
      'discussion.id': req.params.threadId,
      'universe.id': universe.id,
    });
    res.status(code2);
    if (!threads) return;
    if (threads.length === 0) return res.status(404);
    const thread = threads[0];
    if (!thread) return;
    const [code3, comments, users] = await api.discussion.getCommentsByThread(req.session.user, thread.id, false, true);
    res.status(code3)
    if (!comments || !users) return;
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
    const search = req.query.search;
    const [code1, universe] = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname });
    const [code2, items] = await api.item.getByUniverseShortname(req.session.user, req.params.universeShortname, perms.READ, {
      sort: req.query.sort,
      sortDesc: req.query.sort_order === 'desc',
      limit: req.query.limit,
      type: req.query.type,
      tag: req.query.tag,
      search,
    });
    const code = code1 !== 200 ? code1 : code2;
    res.status(code);
    if (code !== 200) return;
    res.prepareRender('universeItemList', {
      items: items.map(item => ({ ...item, itemTypeName: ((universe.obj_data.cats ?? {})[item.item_type] ?? ['Missing Category'])[0] })),
      universe,
      type: req.query.type,
      tag: req.query.tag,
      search,
    });
  },

  async editPerms(req, res) {
    const [code1, universe] = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, perms.ADMIN);
    const [code2, users] = await api.user.getMany();
    const [code3, contacts] = await api.contact.getAll(req.session.user, false);
    const [code4, requests] = await api.universe.getAccessRequests(req.session.user, req.params.universeShortname);
    const code = code1 !== 200 ? code1 : (code2 !== 200 ? code2 : (code3 !== 200 ? code3 : code4));
    res.status(code);
    if (code !== 200) return;
    contacts.forEach(contact => {
      if (!(contact.id in universe.authors)) {
        universe.authors[contact.id] = contact.username;
        universe.author_permissions[contact.id] = perms.NONE;
      }
    });
    let ownerCount = 0;
    for (const userID in universe.author_permissions) {
      if (universe.author_permissions[userID] === perms.OWNER) ownerCount++;
    }
    res.prepareRender('editUniversePerms', { universe, users, requests, ownerCount });
  },
};
