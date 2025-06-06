const { ADDR_PREFIX, DEV_MODE } = require('../../config');
const Auth = require('../../middleware/auth');
const api = require('../../api');
const md5 = require('md5');
const { render } = require('../../templates');
const { perms, Cond, getPfpUrl } = require('../../api/utils');
const fs = require('fs/promises');
const logger = require('../../logger');

module.exports = {
  /* User Pages */
  async contactList(req, res) {
    const [code, contacts] = await api.contact.getAll(req.session.user);
    res.status(code);
    if (!contacts) return;
    const gravatarContacts = contacts.map(user => ({
      ...user,
      pfpUrl: getPfpUrl(user),
    }));
    res.prepareRender('contactList', {
      contacts: gravatarContacts.filter(contact => contact.accepted),
      pending: gravatarContacts.filter(contact => !contact.accepted),
    });
  },

  async profilePage(req, res) {
    const [code1, user] = await api.user.getOne({ 'user.username': req.params.username });
    res.status(code1);
    if (!user) return;
    const [code2, universes] = await api.universe.getManyByAuthorId(req.session.user, user.id);
    res.status(code2);
    if (!universes) return;
    const [code3, recentlyUpdated] = await api.item.getMany(req.session.user, null, perms.READ, {
      sort: 'updated_at',
      sortDesc: true,
      limit: 15,
      select: [['lub.username', 'last_updated_by']],
      join: [['LEFT', ['user', 'lub'], new Cond('lub.id = item.last_updated_by')]],
      where: new Cond('item.author_id = ?', user.id)
        .and(new Cond('lub.id = ?', user.id).or('item.last_updated_by IS NULL')),
    });
    res.status(code3);
    const [code4, items] = await api.item.getByAuthorUsername(req.session.user, user.username, perms.READ, {
      sort: 'updated_at',
      sortDesc: true,
      limit: 15
    });
    res.status(code4);
    if (!items) return;
    if (req.session.user?.id !== user.id) {
      const [_, contact] = await api.contact.getOne(req.session.user, user.id);
      user.isContact = contact !== undefined;
    } else {
      user.isMe = true;
    }
    res.prepareRender('user', { 
      user,
      items,
      pfpUrl: getPfpUrl(user),
      universes,
      recentlyUpdated,
    });
  },
  
  async settings(req, res) {
    const [code, user] = await api.user.getOne({ 'user.id': req.session.user.id });
    res.status(code);
    if (!user) return;
    const [code2, typeSettingData] = await api.notification.getTypeSettings(user);
    res.status(code2);
    if (!typeSettingData) return;
    const typeSettings = {};
    for (const setting of typeSettingData) {
      typeSettings[`${setting.notif_type}_${setting.notif_method}`] = Boolean(setting.is_enabled);
    }
    const [, deleteRequest] = await api.user.getDeleteRequest(user);
    res.prepareRender('settings', {
      user,
      typeSettings,
      deleteRequest,
      notificationTypes: api.notification.types,
      notificationMethods: api.notification.methods,
    });
  },

  async requestVerify(req, res) {
    if (!req.session.user) return res.status(401);
    if (req.session.user.verified) return res.redirect(`${ADDR_PREFIX}/`);
    const [code, data] = await api.email.trySendVerifyLink(req.session.user, req.session.user.username);
    if (data && data.alreadyVerified) {
      return res.redirect(`${ADDR_PREFIX}${req.query.page || '/'}${req.query.search ? `?${req.query.search}` : ''}`);
    }
    res.prepareRender('verify', { 
      user: req.session.user,
      gravatarLink: `https://www.gravatar.com/avatar/${md5(req.session.user.email)}.jpg`,
      nextPage: `${req.query.page || '/'}${req.query.search ? `?${req.query.search}` : ''}`,
      reason: req.query.reason,
    });
  },

  async verifyUser(req, res) {
    const [code, userId] = await api.user.verifyUser(req.params.key)
    res.status(code);
    if (code === 200) {
      const [_, user] = await api.user.getOne({ id: userId });
      if (user) {
        // TODO should we send a welcome email?
        // api.email.sendTemplateEmail(api.email.templates.WELCOME, req.body.email, { username: user.username });
        return res.redirect(`${ADDR_PREFIX}/`);
      }
    } else {
      return res.redirect(`${ADDR_PREFIX}/verify?reason=bad_key`);
    }
  },

  async notifications(req, res) {
    if (req.session.user) {
      const [code, notifications] = await api.notification.getSentNotifications(req.session.user);
      res.status(code);
      if (code !== 200) return;
      res.prepareRender('notifications', {
        read: notifications.filter(notif => notif.is_read),
        unread: notifications.filter(notif => !notif.is_read),
      });
    }
  },
};
