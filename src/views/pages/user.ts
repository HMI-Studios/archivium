import md5 from 'md5';
import { RouteHandler } from '..';
import api from '../../api';
import { Cond, handleAsNull, handleErrorWithData, perms } from '../../api/utils';
import { NotFoundError, UnauthorizedError } from '../../errors';
import { getPfpUrl } from '../../lib/utils';
import { grantableUniverses } from '../../mcp/grants';

export default {
  /* User Pages */
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
    const pfpUrl = getPfpUrl(user);
    const isSelf = req.session.user?.id === user.id;
    if (!isSelf) {
      const contact = await api.contact.getOne(req.session.user, user.id).catch(handleAsNull(NotFoundError));
      user.isContact = contact !== null;
    }
    res.prepareRender('user', {
      user: isSelf ? user : api.user.toBasicUser(user),
      items,
      pfpUrl,
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
    const connectedApps = await api.oauth.getGrants(user.id);
    const grantable = connectedApps.length > 0 ? await grantableUniverses(user) : [];
    res.prepareRender('settings', {
      user,
      connectedApps,
      grantableUniverses: grantable,
      typeSettings,
      deleteRequest,
      notificationTypes: api.notification.types,
      notificationMethods: api.notification.methods,
    });
  },

  async requestVerify(req, res) {
    if (!req.session.user) throw new UnauthorizedError();
    if (req.session.user.verified) {
      res.redirect('/');
      return;
    }
    const data = await api.email.trySendVerifyLink(req.session.user, req.session.user.username).catch((error) => handleErrorWithData<Date>(error));
    if (data && !(data instanceof Date) && data.alreadyVerified) {
      res.redirect(`${req.query.page || '/'}${req.query.search ? `?${req.query.search}` : ''}`);
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
    await api.user.verifyUser(req.params.key);
    try {
      // TODO should we send a welcome email?
      // api.email.sendTemplateEmail(api.email.templates.WELCOME, req.body.email, { username: user.username });
      return res.redirect('/');
    } catch (e) {
      if (e instanceof NotFoundError) {
        return res.redirect('/verify?reason=bad_key');
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
