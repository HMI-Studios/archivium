import { ADDR_PREFIX } from '../../config';
import api from '../../api';
import md5 from 'md5';
import { render } from '../../templates';
import { perms, Cond, getPfpUrl, handleAsNull, handleErrorWithData } from '../../api/utils';
import fs from 'fs/promises';
import logger from '../../logger';
import { RouteHandler } from '..';
import { NotFoundError, UnauthorizedError } from '../../errors';

export default {
  /* User Pages */
  async contactList(req, res) {
    const contacts = await api.contact.getAll(req.session.user);
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
    const user = await api.user.getOne({ 'user.username': req.params.username });
    const universes = await api.universe.getManyByAuthorId(req.session.user, user.id);
    const recentlyUpdated = await api.item.getMany(req.session.user, null, perms.READ, {
      sort: 'updated_at',
      sortDesc: true,
      limit: 15,
      select: [['lub.username', 'last_updated_by']],
      join: [['LEFT', ['user', 'lub'], new Cond('lub.id = item.last_updated_by')]],
      where: new Cond('lub.id = ?', user.id).or(new Cond('item.last_updated_by IS NULL').and('item.author_id = ?', user.id)),
    });
    const items = await api.item.getByAuthorUsername(req.session.user, user.username, perms.READ, {
      sort: 'updated_at',
      sortDesc: true,
      limit: 15
    });
    if (!items) return;
    if (req.session.user?.id !== user.id) {
      const contact = await api.contact.getOne(req.session.user, user.id).catch(handleAsNull(NotFoundError));
      user.isContact = contact !== null;
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
    const user = await api.user.getOne({ 'user.id': req.session.user?.id });
    const typeSettingData = await api.notification.getTypeSettings(user);
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
    if (!req.session.user) throw new UnauthorizedError();
    if (req.session.user.verified) {
      res.redirect(`${ADDR_PREFIX}/`);
      return;
    }
    const data = await api.email.trySendVerifyLink(req.session.user, req.session.user.username).catch(handleErrorWithData);
    if (data && !(data instanceof Date) && data.alreadyVerified) {
      res.redirect(`${ADDR_PREFIX}${req.query.page || '/'}${req.query.search ? `?${req.query.search}` : ''}`);
      return;
    }
    res.prepareRender('verify', { 
      user: req.session.user,
      gravatarLink: req.session.user.email && `https://www.gravatar.com/avatar/${md5(req.session.user.email)}.jpg`,
      nextPage: `${req.query.page || '/'}${req.query.search ? `?${req.query.search}` : ''}`,
      reason: req.query.reason,
    });
  },

  async verifyUser(req, res) {
    const userId = await api.user.verifyUser(req.params.key);
    const user = await api.user.getOne({ id: userId });
    try {
      // TODO should we send a welcome email?
      // api.email.sendTemplateEmail(api.email.templates.WELCOME, req.body.email, { username: user.username });
      return res.redirect(`${ADDR_PREFIX}/`);
    } catch (e) {
      if (e instanceof NotFoundError) {
        return res.redirect(`${ADDR_PREFIX}/verify?reason=bad_key`);
      }
      throw e;
    }
  },

  async notifications(req, res) {
    if (req.session.user) {
      const notifications = await api.notification.getSentNotifications(req.session.user);
      if (!notifications) return;
      res.prepareRender('notifications', {
        read: notifications.filter(notif => notif.is_read),
        unread: notifications.filter(notif => !notif.is_read),
      });
    }
  },
} satisfies Record<string, RouteHandler>;
