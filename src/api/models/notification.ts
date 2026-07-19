import { EnumDeclaration } from "typescript";
import { API } from "..";
import { User } from "./user";
import { ResultSetHeader } from "mysql2";
import { ForbiddenError, ModelError, NotFoundError, UnauthorizedError, ValidationError } from "../../errors";

const { executeQuery, parseData } = require('../utils');
const { WEB_PUSH_ENABLED, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, ADDR_PREFIX, DOMAIN } = require('../../config');
const logger = require('../../logger');
const md5 = require('md5');
const webpush = require('web-push');

if (WEB_PUSH_ENABLED) {
  webpush.setVapidDetails(
    'mailto:contact@archivium.net',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

export type NotificationSubscription = {
  id: number,
  user_id: number,
  endpoint_hash: string,
  push_endpoint: string,
  push_keys: {},
};

export type SentNotification = {
  id: number,
  title: string,
  body: string | null,
  icon_url: string | null,
  click_url: string | null,
  notif_type: string,
  user_id: number,
  sent_at: Date,
  is_read: boolean,
  comment_id: number | null,
};

export type NotificationTypeSetting = {
  id: number,
  user_id: number,
  notif_type: string,
  notif_method: string,
  is_enabled: boolean,
};

enum methods {
  WEB,
  PUSH,
  EMAIL,
};

export type NotificationType = 'contacts' | 'universe' | 'comments' | 'features';
const types: { [key: string]: NotificationType } = {
  CONTACTS: 'contacts',
  UNIVERSE: 'universe',
  COMMENTS: 'comments',
  FEATURES: 'features',
} as const;

const methodDict = Object.keys(methods)
  .filter((x) => Number.isNaN(Number(x)))
  .reduce((acc, key) => ({ ...acc, [key]: methods[key] }), {});

export class NotificationAPI {
  readonly api: API;
  readonly types = types;
  readonly methods = methodDict;

  constructor(api: API) {
    this.api = api;
  }

  async getOne(user: User, endpoint: string): Promise<NotificationSubscription> {
    const endpointHash = md5(endpoint);

    const subscription = (await executeQuery('SELECT * FROM notificationsubscription WHERE user_id = ? AND endpoint_hash = ?', [user.id, endpointHash]))[0];
    return subscription;
  }

  async getByEndpoint(endpoint: string): Promise<NotificationSubscription> {
    const endpointHash = md5(endpoint);

    const subscription = (await executeQuery('SELECT * FROM notificationsubscription WHERE endpoint_hash = ?', [endpointHash]))[0];
    return subscription;
  }

  async getByUser(user: User): Promise<NotificationSubscription[]> {
    const subscriptions = await executeQuery('SELECT * FROM notificationsubscription WHERE user_id = ?', [user.id]);
    return subscriptions;
  }

  async isSubscribed(user: User | undefined, subscriptionData): Promise<boolean> {
    const { endpoint } = subscriptionData;
    if (!endpoint || !user) return false;
    const subscription = await this.getByEndpoint(endpoint);
    return Boolean(subscription && subscription.user_id === user.id);
  }

  async subscribe(user: User | undefined, subscriptionData): Promise<string> {
    if (!user) throw new UnauthorizedError();
    const { endpoint, keys } = subscriptionData;
    if (!endpoint || !keys) throw new ValidationError('Missing subscription data');
    const subscription = await this.getByEndpoint(endpoint);
    const endpointHash = md5(endpoint);
    if (!subscription) {
      await executeQuery('INSERT INTO notificationsubscription (user_id, endpoint_hash, push_endpoint, push_keys) VALUES (?, ?, ?, ?)', [
        user.id,
        endpointHash,
        endpoint,
        keys,
      ]);
      logger.info(`New subscription added for ${user.username}`);
    } else if (subscription.user_id !== user.id) {
      await executeQuery('UPDATE notificationsubscription SET user_id = ? WHERE endpoint_hash = ?', [user.id, endpointHash]);
      logger.info(`Subscription user changed to ${user.username}`);
    } else {
      logger.info(`Duplicate subscription ignored for ${user.username}`);
    }
    return endpointHash;
  }

  async unsubscribe(user: User | undefined, subscriptionData): Promise<NotificationSubscription> {
    if (!user) throw new UnauthorizedError();
    const { endpoint, keys } = subscriptionData;
    if (!endpoint || !keys) throw new ValidationError('Missing subscription data');
    const subscription = await this.getByEndpoint(endpoint);
    if (subscription.user_id === user.id) {
      const endpointHash = md5(endpoint);
      await executeQuery('DELETE FROM notificationsubscription WHERE user_id = ? AND endpoint_hash = ?', [user.id, endpointHash]);
      logger.info(`Unsubscribed ${user.username}`);
      return subscription;
    } else {
      throw new ForbiddenError();
    }
  }

  async notify(target: User, notifType: NotificationType, message: { title: string, body: string | null, icon?: string, clickUrl?: string }, dedupKey?: string, commentId?: number): Promise<void> {
    const { title, body, icon, clickUrl } = message;
    if (!title || (!body && !commentId)) throw new ValidationError('Missing notification data');

    const settings = await this.getTypeSettings(target);
    const enabledMethods = settings.filter(s => s.notif_type === notifType).reduce((acc, val) => ({ ...acc, [val.notif_method]: Boolean(val.is_enabled) }), {});

    let previousNotif: { id: number } | null = null;
    if (dedupKey) {
      previousNotif = (await executeQuery(`
        SELECT id
        FROM sentnotification
        WHERE dedup_key = ?
          AND sent_at > DATE_SUB(NOW(), INTERVAL 2 DAY)
          AND NOT is_read
          AND user_id = ?
          AND notif_type = ?
      `, [dedupKey, target.id, notifType]))[0];
    }
    
    if (previousNotif) {
      await executeQuery('UPDATE sentnotification SET title = ?, body = ?, icon_url = ?, click_url = ?, sent_at = ?, comment_id = ? WHERE id = ?', [
        title,
        body,
        icon ?? null,
        clickUrl ?? null,
        new Date(),
        commentId ?? null,
        previousNotif.id,
      ]);
    } else {
      const autoMark = enabledMethods[methods.WEB] === false;
      const { insertId } = await executeQuery('INSERT INTO sentnotification (title, body, icon_url, click_url, notif_type, user_id, sent_at, is_read, dedup_key, comment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        title,
        body,
        icon ?? null,
        clickUrl ?? null,
        notifType,
        target.id,
        new Date(),
        autoMark,
        dedupKey ?? null,
        commentId ?? null,
      ]);

      let actualBody = '';
      if (body) actualBody = body;
      if (notifType === 'comments' && commentId) {
        actualBody = await executeQuery('SELECT body FROM comment WHERE id = ?', [commentId])[0]?.body;
      }

  
      const payload = JSON.stringify({ id: insertId, title, body: actualBody, icon, clickUrl });
      if (WEB_PUSH_ENABLED && enabledMethods[methods.PUSH]) {
        const subscriptions = await this.getByUser(target);
        for (const { push_endpoint, push_keys } of subscriptions) {
          await webpush.sendNotification({ endpoint: push_endpoint, keys: push_keys }, payload).catch(err => {
            logger.error(err);
            // subscriptions.splice(index, 1); // Remove invalid subscriptions
          });
        }
      }
  
      if (enabledMethods[methods.EMAIL] && target.email_notifications) {
        await this.api.email.sendTemplateEmail(
          this.api.email.templates.NOTIFY,
          target.email,
          { title, body: actualBody, icon, clickUrl: `https://${DOMAIN}${ADDR_PREFIX}${clickUrl}` },
        );
      }
    }
  }

  /**
   * 
   * @param {*} user 
   * @returns {Promise<[number, QueryResult]>}
   */
  async getSentNotifications(user: User): Promise<SentNotification[]> {
    if (!user) throw new UnauthorizedError();
    const notifications = await executeQuery(`
      SELECT
        sentnotification.id, sentnotification.title,
        COALESCE(sentnotification.body, comment.body) AS body,
        sentnotification.icon_url, sentnotification.click_url,
        sentnotification.notif_type, sentnotification.user_id,
        sentnotification.sent_at, sentnotification.is_read,
        sentnotification.dedup_key, sentnotification.comment_id
      FROM sentnotification
      LEFT JOIN comment ON comment.id = sentnotification.comment_id
      WHERE sentnotification.user_id = ?
      ORDER BY sent_at DESC
    `, [user.id]);
    return notifications;
  }

  async markRead(user: User | undefined, id: number, isRead: boolean): Promise<void> {
    if (!(typeof isRead === 'boolean')) throw new ValidationError('Invalid read status');
    if (!user) throw new UnauthorizedError();
    const data = await executeQuery('UPDATE sentnotification SET is_read = ? WHERE id = ? AND user_id = ?', [isRead, id, user.id]);
    if (data.changedRows === 0) throw new NotFoundError();
  }

  async markAllRead(user: User | undefined, isRead: boolean): Promise<void> {
    if (!user) throw new UnauthorizedError();
    await executeQuery('UPDATE sentnotification SET is_read = ? WHERE user_id = ?', [isRead, user.id]);
  }

  async putNotificationType(user: User, type: string, method: number, enabled: boolean): Promise<void> {
    const setting = (await executeQuery('SELECT is_enabled FROM notificationtype WHERE user_id = ? AND notif_type = ? AND notif_method = ?', [user.id, type, method]))[0];
    const wasEnabled = Boolean(setting?.is_enabled);
    if (!setting) {
      await executeQuery('INSERT INTO notificationtype (user_id, notif_type, notif_method, is_enabled) VALUES (?, ?, ?, ?)', [user.id, type, method, enabled]);
    } else if (enabled !== wasEnabled) {
      await executeQuery('UPDATE notificationtype SET is_enabled = ? WHERE user_id = ? AND notif_type = ? AND notif_method = ?', [enabled, user.id, type, method]);
    }
  }

  async putSettings(user: User | undefined, changes): Promise<void> {
    if (!user) throw new UnauthorizedError();

    if ('email_notifs' in changes) {
      await executeQuery('UPDATE user SET email_notifications = ? WHERE id = ?', [Boolean(changes.email_notifs), user.id]);
    }

    for (const type of Object.values(this.types)) {
      for (const method of Object.values(methods).filter(val => typeof val === 'number')) { // Required because of how typescript handles enums
        if (`${type}_${method}` in changes) {
          await this.putNotificationType(user, type, method, changes[`${type}_${method}`]);
        }
      }
    }
  }

  async getTypeSettings(user: User): Promise<NotificationTypeSetting[]> {
    if (!user) throw new UnauthorizedError();
    const settings = await executeQuery('SELECT * FROM notificationtype WHERE user_id = ?', [user.id]);
    return settings;
  }
}
