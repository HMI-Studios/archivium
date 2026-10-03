import { sql } from 'kysely';
import { API } from "..";
import { kysely } from '../../db/kysely';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "../../errors";
import { User } from "./user";

const { WEB_PUSH_ENABLED, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, DOMAIN } = require('../../config');
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
  push_keys: {} | null,
};

export type SentNotification = {
  id: number,
  title: string | null,
  body: string | null,
  icon_url: string | null,
  click_url: string | null,
  notif_type: string,
  user_id: number,
  sent_at: Date,
  is_read: boolean | null,
  comment_id: number | null,
};

export type NotificationTypeSetting = {
  user_id: number,
  notif_type: string,
  notif_method: number,
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

  async getOne(user: User, endpoint: string): Promise<NotificationSubscription | undefined> {
    const endpointHash = md5(endpoint);

    const subscription = await kysely
      .selectFrom('notificationsubscription')
      .selectAll()
      .where('user_id', '=', user.id)
      .where('endpoint_hash', '=', endpointHash)
      .executeTakeFirst();
    return subscription;
  }

  async getByEndpoint(endpoint: string): Promise<NotificationSubscription | undefined> {
    const endpointHash = md5(endpoint);

    const subscription = await kysely
      .selectFrom('notificationsubscription')
      .selectAll()
      .where('endpoint_hash', '=', endpointHash)
      .executeTakeFirst();
    return subscription;
  }

  async getByUser(user: Pick<User, 'id'>): Promise<NotificationSubscription[]> {
    const subscriptions = await kysely
      .selectFrom('notificationsubscription')
      .selectAll()
      .where('user_id', '=', user.id)
      .execute();
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
      await kysely
        .insertInto('notificationsubscription')
        .values({
          user_id: user.id,
          endpoint_hash: endpointHash,
          push_endpoint: endpoint,
          push_keys: typeof keys === 'string' ? keys : JSON.stringify(keys),
        })
        .execute();
      logger.info(`New subscription added for ${user.username}`);
    } else if (subscription.user_id !== user.id) {
      await kysely
        .updateTable('notificationsubscription')
        .set({ user_id: user.id })
        .where('endpoint_hash', '=', endpointHash)
        .execute();
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
    if (subscription!.user_id === user.id) {
      const endpointHash = md5(endpoint);
      await kysely
        .deleteFrom('notificationsubscription')
        .where('user_id', '=', user.id)
        .where('endpoint_hash', '=', endpointHash)
        .execute();
      logger.info(`Unsubscribed ${user.username}`);
      return subscription!;
    } else {
      throw new ForbiddenError();
    }
  }

  async notify(target: Pick<User, 'id' | 'email' | 'email_notifications'>, notifType: NotificationType, message: { title: string, body: string | null, icon?: string, clickUrl?: string }, dedupKey?: string, commentId?: number): Promise<void> {
    const { title, body, icon, clickUrl } = message;
    if (!title || (!body && !commentId)) throw new ValidationError('Missing notification data');

    const settings = await this.getTypeSettings(target);
    const enabledMethods = settings.filter(s => s.notif_type === notifType).reduce((acc, val) => ({ ...acc, [val.notif_method]: Boolean(val.is_enabled) }), {});

    let previousNotif: { id: number } | undefined;
    if (dedupKey) {
      previousNotif = await kysely
        .selectFrom('sentnotification')
        .select('id')
        .where('dedup_key', '=', dedupKey)
        .where('sent_at', '>', sql<Date>`DATE_SUB(NOW(), INTERVAL 2 DAY)`)
        .where('is_read', '=', false)
        .where('user_id', '=', target.id)
        .where('notif_type', '=', notifType)
        .executeTakeFirst();
    }

    if (previousNotif) {
      await kysely
        .updateTable('sentnotification')
        .set({
          title,
          body,
          icon_url: icon ?? null,
          click_url: clickUrl ?? null,
          sent_at: new Date(),
          comment_id: commentId ?? null,
        })
        .where('id', '=', previousNotif.id)
        .execute();
    } else {
      const autoMark = enabledMethods[methods.WEB] === false;
      const { insertId } = await kysely
        .insertInto('sentnotification')
        .values({
          title,
          body,
          icon_url: icon ?? null,
          click_url: clickUrl ?? null,
          notif_type: notifType,
          user_id: target.id,
          sent_at: new Date(),
          is_read: autoMark,
          dedup_key: dedupKey ?? null,
          comment_id: commentId ?? null,
        })
        .executeTakeFirstOrThrow();

      let actualBody = '';
      if (body) actualBody = body;
      if (notifType === 'comments' && commentId) {
        const commentRow = await kysely
          .selectFrom('comment')
          .select('body')
          .where('id', '=', commentId)
          .executeTakeFirst();
        actualBody = commentRow?.body ?? '';
      }

      const payload = JSON.stringify({ id: Number(insertId ?? 0), title, body: actualBody, icon, clickUrl });
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
          { title, body: actualBody, icon, clickUrl: `https://${DOMAIN}${clickUrl}` },
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
    const notifications = await kysely
      .selectFrom('sentnotification')
      .leftJoin('comment', 'comment.id', 'sentnotification.comment_id')
      .select([
        'sentnotification.id',
        'sentnotification.title',
        'sentnotification.icon_url',
        'sentnotification.click_url',
        'sentnotification.notif_type',
        'sentnotification.user_id',
        'sentnotification.sent_at',
        'sentnotification.is_read',
        'sentnotification.dedup_key',
        'sentnotification.comment_id',
      ])
      .select((eb) => eb.fn.coalesce('sentnotification.body', 'comment.body').as('body'))
      .where('sentnotification.user_id', '=', user.id)
      .orderBy('sentnotification.sent_at', 'desc')
      .execute();
    return notifications;
  }

  async markRead(user: User | undefined, id: number, isRead: boolean): Promise<void> {
    if (!(typeof isRead === 'boolean')) throw new ValidationError('Invalid read status');
    if (!user) throw new UnauthorizedError();
    const result = await kysely
      .updateTable('sentnotification')
      .set({ is_read: isRead })
      .where('id', '=', id)
      .where('user_id', '=', user.id)
      .executeTakeFirstOrThrow();
    if (Number(result.numChangedRows) === 0) throw new NotFoundError();
  }

  async markAllRead(user: User | undefined, isRead: boolean): Promise<void> {
    if (!user) throw new UnauthorizedError();
    await kysely
      .updateTable('sentnotification')
      .set({ is_read: isRead })
      .where('user_id', '=', user.id)
      .execute();
  }

  async putNotificationType(user: User, type: string, method: number, enabled: boolean): Promise<void> {
    const setting = await kysely
      .selectFrom('notificationtype')
      .select('is_enabled')
      .where('user_id', '=', user.id)
      .where('notif_type', '=', type)
      .where('notif_method', '=', method)
      .executeTakeFirst();
    const wasEnabled = Boolean(setting?.is_enabled);
    if (!setting) {
      await kysely
        .insertInto('notificationtype')
        .values({ user_id: user.id, notif_type: type, notif_method: method, is_enabled: enabled })
        .execute();
    } else if (enabled !== wasEnabled) {
      await kysely
        .updateTable('notificationtype')
        .set({ is_enabled: enabled })
        .where('user_id', '=', user.id)
        .where('notif_type', '=', type)
        .where('notif_method', '=', method)
        .execute();
    }
  }

  async putSettings(user: User | undefined, changes): Promise<void> {
    if (!user) throw new UnauthorizedError();

    if ('email_notifs' in changes) {
      await kysely
        .updateTable('user')
        .set({ email_notifications: Boolean(changes.email_notifs) })
        .where('id', '=', user.id)
        .execute();
    }

    for (const type of Object.values(this.types)) {
      for (const method of Object.values(methods).filter(val => typeof val === 'number')) { // Required because of how typescript handles enums
        if (`${type}_${method}` in changes) {
          await this.putNotificationType(user, type, method as number, changes[`${type}_${method}`]);
        }
      }
    }
  }

  async getTypeSettings(user: Pick<User, 'id'>): Promise<NotificationTypeSetting[]> {
    if (!user) throw new UnauthorizedError();
    const settings = await kysely
      .selectFrom('notificationtype')
      .selectAll()
      .where('user_id', '=', user.id)
      .execute();
    return settings;
  }
}
