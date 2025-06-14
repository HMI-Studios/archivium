const { ADDR_PREFIX } = require('../config');
const api = require('../api');
const { universeLink } = require('../templates');
const { perms } = require('../api/utils');
const logger = require('../logger');
const pages = require('./pages');

module.exports = {
  async notificationSettings(req, res) {
    const { body, session } = req;
    body['email_notifs'] = body['email_notifs'] === 'on';
    for (const type of Object.values(api.notification.types)) {
      for (const method of Object.values(api.notification.methods)) {
        body[`${type}_${method}`] = body[`notif_${type}_${method}`] === 'on';
        delete body[`notif_${type}_${method}`];
      }
    }
    const [code, data] = await api.notification.putSettings(session.user, body);
    res.status(code);
    return res.redirect(`${ADDR_PREFIX}/settings`);
  },

  async createUniverse(req, res) {
    const [code, data] = await api.universe.post(req.session.user, {
      ...req.body,
      obj_data: decodeURIComponent(req.body.obj_data),
      public: req.body.visibility === 'public',
      discussion_enabled: req.body.discussion_enabled === 'enabled',
      discussion_open: req.body.discussion_open === 'enabled',
    });
    res.status(code);
    if (code === 201) return res.redirect(`${universeLink(req, req.body.shortname)}/`);
    res.prepareRender('createUniverse', { error: data, ...req.body });
  },

  async editUniverse(req, res) {
    req.body = {
      ...req.body,
      obj_data: decodeURIComponent(req.body.obj_data),
      public: req.body.visibility === 'public',
      discussion_enabled: req.body.discussion_enabled === 'enabled',
      discussion_open: req.body.discussion_open === 'enabled',
    }
    const [code, errOrId] = await api.universe.put(req.session.user, req.params.universeShortname, req.body);
    res.status(code);
    if (code !== 200) {
      await pages.universe.edit(req, res, errOrId, req.body);
      return;
    } else {
      const [code, universe] = await api.universe.getOne(req.session.user, { 'universe.id': errOrId }, perms.READ);
      res.status(code);
      if (!universe) return;
      res.redirect(`${universeLink(req, universe.shortname)}`);
    }
  },

  async createUniverseThread(req, res) {
    const [code1, data] = await api.discussion.postUniverseThread(req.session.user, req.params.universeShortname, { title: req.body.title });
    res.status(code1);
    if (code1 === 201) {
      if (req.body.comment) {
        const [code2, _] = await api.discussion.postCommentToThread(req.session.user, data.insertId, { body: req.body.comment });
        res.status(code2);
      }
      return res.redirect(`${universeLink(req, req.params.universeShortname)}/discuss/${data.insertId}`);
    }
    const [code3, universe] = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname });
    res.status(code3);
    if (code3 !== 200) return;
    res.prepareRender('createUniverseThread', { error: data, ...req.body, universe });
  },

  async commentOnThread(req, res) {
    const [code, _] = await api.discussion.postCommentToThread(req.session.user, req.params.threadId, req.body);
    res.status(code);
    return res.redirect(`${universeLink(req, req.params.universeShortname)}/discuss/${req.params.threadId}#post-comment`);
  },
 
  async createItem(req, res) {
    const [userCode, data] = await api.item.post(req.session.user, {
      ...req.body,
    }, req.params.universeShortname);
    res.status(userCode);
    if (userCode === 201) return res.redirect(`${universeLink(req, req.params.universeShortname)}/items/${req.body.shortname}`);
    const [code, universe] = await api.universe.getOne(req.session.user, { shortname: req.params.universeShortname });
    res.status(code);
    if (code !== 200) return;
    res.prepareRender('createItem', { error: data, ...req.body, universe });
  },

  async editItem(req, res) {
    const [code, errOrId] = await api.item.save(req.session.user, req.params.universeShortname, req.params.itemShortname, req.body);
    res.status(code);
    if (code !== 200) {
      await pages.item.edit(req, res, errOrId, req.body);
      return;
    } else {
      const [code, item] = await api.item.getOne(req.session.user, { 'item.id': errOrId }, perms.READ, true);
      res.status(code);
      if (!item) return;
      res.redirect(`${universeLink(req, req.params.universeShortname)}/items/${item.shortname}`);
    }
  },

  async commentOnItem(req, res) {
    const [code, _] = await api.discussion.postCommentToItem(req.session.user, req.params.universeShortname, req.params.itemShortname, req.body);
    res.status(code);
    res.redirect(`${universeLink(req, req.params.universeShortname)}/items/${req.params.itemShortname}?tab=comments#post-comment`);
  },

  async editUniversePerms(req, res) {
    const { session, params, body } = req;
    const [_, user] = await api.user.getOne({ 'user.username': req.body.username });
    const [code] = await api.universe.putPermissions(session.user, params.universeShortname, user, body.permission_level);
    res.status(code);
    if (code !== 200) return;
    res.redirect(`${universeLink(req, params.universeShortname)}/permissions`);
  },

  async createNote(req, res) {
    const { body, session } = req;
    const [code, data, uuid] = await api.note.post(session.user, {
      title: body.note_title,
      public: body.note_public === 'on',
      body: body.note_body,
      tags: body.note_tags?.split(' ') ?? [],
    });
    let nextPage;
    if (body.note_item && body.note_universe) {
      const [code, data] = await api.note.linkToItem(session.user, body.note_universe, body.note_item, uuid);
      if (code !== 201) return logger.error(`Error ${code}: ${data}`);
      nextPage = nextPage || `${universeLink(req, body.note_universe)}/items/${body.note_item}?tab=notes&note=${uuid}`;
    }
    if (body.note_board && body.note_universe) {
      const [code, data] = await api.note.linkToBoard(session.user, body.note_board, uuid);
      if (code !== 201) return logger.error(`Error ${code}: ${data}`);
      nextPage = nextPage || `${universeLink(req, body.note_universe)}/notes/${body.note_board}?note=${uuid}`;
    }
    res.status(code);
    if (code === 201) return res.redirect(nextPage || `${ADDR_PREFIX}/notes?note=${uuid}`);
    return logger.error(`Error ${code}: ${data}`);
    // res.prepareRender('createUniverse', { error: data, ...req.body });
  },

  async editNote(req, res) {
    const { body, session } = req;
    const [code, data] = await api.note.put(session.user, body.note_uuid, {
      title: body.note_title,
      public: body.note_public === 'on',
      body: body.note_body,
      items: body.items,
      boards: body.boards,
      tags: body.note_tags?.split(' ') ?? [],
    });
    let nextPage;
    if (body.note_item && body.note_universe) {
      nextPage = nextPage || `${universeLink(req, body.note_universe)}/items/${body.note_item}?tab=notes&note=${body.note_uuid}`;
    }
    if (body.note_board && body.note_universe) {
      nextPage = nextPage || `${universeLink(req, body.note_universe)}/notes/${body.note_board}?note=${body.note_uuid}`;
    }
    res.status(code);
    if (code === 200) return res.redirect(nextPage || `${ADDR_PREFIX}/notes?note=${body.note_uuid}`);
    return logger.error(`Error ${code}: ${data}`);
    // res.prepareRender('createUniverse', { error: data, ...req.body });
  },

  async createStory(req, res) {
    const [code, data] = await api.story.post(req.session.user, {
      ...req.body,
      public: req.body.drafts_public === 'public',
    });
    res.status(code);
    if (code === 201) return res.redirect(`${ADDR_PREFIX}/stories/${req.body.shortname}`);
    const [_, universes] = await api.universe.getMany(req.session.user, null, perms.WRITE);
    res.prepareRender('createStory', { universes: universes ?? [], error: data, ...req.body });
  },

  async editStory(req, res) {
    req.body = {
      ...req.body,
      drafts_public: req.body.drafts_public === 'on',
    }
    const [code, errorOrShortname] = await api.story.put(req.session.user, req.params.shortname, req.body);
    res.status(code);
    if (code !== 200) {
      await pages.story.edit(req, res, errorOrShortname, req.body);
      return;
    } else {
      res.redirect(`${ADDR_PREFIX}/stories/${errorOrShortname}`);
    }
  },

  async editChapter(req, res) {
    req.body = {
      ...req.body,
      is_published: req.body.is_published === 'on',
    }
    const [code, errorOrIndex] = await api.story.putChapter(req.session.user, req.params.shortname, req.params.index, req.body);
    res.status(code);
    if (code !== 200) {
      await pages.story.editChapter(req, res, errorOrIndex, req.body);
      return;
    } else {
      res.redirect(`${ADDR_PREFIX}/stories/${req.params.shortname}/${errorOrIndex}`);
    }
  },

  async commentOnChapter(req, res) {
    const [code, _] = await api.discussion.postCommentToChapter(req.session.user, req.params.shortname, req.params.index, req.body);
    res.status(code);
    res.redirect(`${ADDR_PREFIX}/stories/${req.params.shortname}/${req.params.index}#post-comment`);
  },

  async passwordResetRequest(req, res) {
    const { body } = req;
    const [code, user] = await api.user.getOne({ email: body.email });
    if (user) {
      const [code2, data] = await api.email.trySendPasswordReset(user);
      if (code2 === 429) {
        return res.prepareRender('forgotPassword', { error: `Please wait ${(data - new Date()) / 1000} seconds before trying again.` });
      } else {
        return res.prepareRender('forgotPassword', { success: 'Email sent!' });
      }
    } else {
      res.status(code);
      return res.prepareRender('forgotPassword', { error: `Error: ${code}` });
    }
  },

  async resetPassword(req, res) {
    const { body } = req;
    if (body.newPassword !== body.confirmPassword) {
      res.status(400);
      return res.prepareRender('resetPassword', { error: 'New password and confirmation do not match.' });
    }
    const [code, userId] = await api.user.resetPassword(req.params.key, body.newPassword);
    res.status(code);
    if (code === 200) {
      const [_, user] = await api.user.getOne({ id: userId });
      if (user) {
        return res.redirect(`${ADDR_PREFIX}/`);
      }
    } else {
      return res.prepareRender('resetPassword', { error: 'This password reset link seems to be broken or expired — try requesting a new one.' });
    }
  },
};
