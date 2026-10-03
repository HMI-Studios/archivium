import { SqlBool } from 'kysely';
import { kysely } from '../../db/kysely';
import { getPfpUrl, handleAsNull } from '../utils';
import { API } from '..';
import { User } from './user';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../errors';

export type ContactUser = Pick<User, 'id' | 'username' | 'email' | 'created_at' | 'updated_at'> & {
  hasPfp: SqlBool,
  accepted: boolean | null,
  is_request: SqlBool,
  requesting_id: number,
  accepting_id: number,
};

export type ContactListEntry = Pick<User, 'id' | 'username' | 'email' | 'created_at' | 'updated_at'> & {
  accepted: boolean | null,
  is_request: SqlBool,
  hasPfp: SqlBool,
  plan: number | null,
};

export class ContactAPI {
  readonly api: API;

  constructor(api: API) {
    this.api = api;
  }

  async getOne(sessionUser: User | undefined, targetID: number): Promise<ContactUser> {
    if (!sessionUser) throw new UnauthorizedError();

    const user = await kysely
      .selectFrom('contact')
      .innerJoin('user', (join) => join.on((eb) => eb.or([
        eb('user.id', '=', eb.ref('contact.requesting_user')),
        eb('user.id', '=', eb.ref('contact.accepting_user')),
      ])))
      .leftJoin('userimage as ui', 'ui.user_id', 'user.id')
      .select((eb) => [
        'user.id',
        'user.username',
        'user.email',
        'user.created_at',
        'user.updated_at',
        eb('ui.user_id', 'is not', null).as('hasPfp'),
        'contact.accepted',
        eb('contact.accepting_user', '=', sessionUser.id).as('is_request'),
        'contact.requesting_user as requesting_id',
        'contact.accepting_user as accepting_id',
      ])
      .where('user.id', '<>', sessionUser.id)
      .where((eb) => eb.or([
        eb.and([
          eb('contact.requesting_user', '=', sessionUser.id),
          eb('contact.accepting_user', '=', targetID),
        ]),
        eb.and([
          eb('contact.accepting_user', '=', sessionUser.id),
          eb('contact.requesting_user', '=', targetID),
        ]),
      ]))
      .executeTakeFirst();

    if (!user) throw new NotFoundError();
    return user;
  }

  async getAll(user: User | undefined, includePending = true, includeAccepted = true): Promise<ContactListEntry[]> {
    if (!(includePending || includeAccepted)) throw new ValidationError('Either includePending or includeAccepted must be true');
    if (!user) throw new UnauthorizedError();

    let query = kysely
      .selectFrom('contact')
      .innerJoin('user', (join) => join.on((eb) => eb.or([
        eb('user.id', '=', eb.ref('contact.requesting_user')),
        eb('user.id', '=', eb.ref('contact.accepting_user')),
      ])))
      .leftJoin('userimage as ui', 'ui.user_id', 'user.id')
      .leftJoin('userplan', 'userplan.user_id', 'user.id')
      .select((eb) => [
        'user.id',
        'user.username',
        'user.email',
        'user.created_at',
        'user.updated_at',
        'contact.accepted',
        eb('contact.accepting_user', '=', user.id).as('is_request'),
        eb('ui.user_id', 'is not', null).as('hasPfp'),
        'userplan.plan',
      ])
      .where('user.id', '<>', user.id)
      .where((eb) => eb.or([
        eb('contact.requesting_user', '=', user.id),
        eb('contact.accepting_user', '=', user.id),
      ]));

    if (includePending !== includeAccepted) {
      query = query.where('contact.accepted', '=', includeAccepted);
    }

    const users = await query.execute();
    return users;
  }

  async post(user: User | undefined, username: string): Promise<{ insertId: number }> {
    if (!user) throw new UnauthorizedError();

    const target = await this.api.user.getOne({ 'user.username': username });
    if (!target) throw new NotFoundError();
    if (target.id === user.id) throw new ValidationError('Cannot contact yourself');
    const contact = await this.getOne(user, target.id).catch(handleAsNull(NotFoundError));
    if (contact) throw new ValidationError('Already a contact');

    const result = await kysely
      .insertInto('contact')
      .values({
        requesting_user: user.id,
        accepting_user: target.id,
        accepted: false,
      })
      .executeTakeFirstOrThrow();

    await this.api.notification.notify(target, this.api.notification.types.CONTACTS, {
      title: 'Contact Request',
      body: `${user.username} has sent you a contact request.`,
      icon: getPfpUrl(user),
      clickUrl: '/contacts',
    });

    return { insertId: Number(result.insertId ?? 0) };
  }

  async put(user: User | undefined, username: string, accepted: boolean): Promise<{ numUpdatedRows: number } | { numDeletedRows: number }> {
    if (!user) throw new UnauthorizedError();
    const target = await this.api.user.getOne({ 'user.username': username });
    const contact = await this.getOne(user, target.id);

    let result: { numUpdatedRows: number } | { numDeletedRows: number };
    if (accepted) {
      const updateResult = await kysely
        .updateTable('contact')
        .set({ accepted: true })
        .where('requesting_user', '=', contact.requesting_id!)
        .where('accepting_user', '=', contact.accepting_id!)
        .executeTakeFirstOrThrow();
      result = { numUpdatedRows: Number(updateResult.numUpdatedRows) };
    } else {
      result = await this.del(user, target.id);
    }

    await this.api.notification.notify(target, this.api.notification.types.CONTACTS, {
      title: `Contact Request ${accepted ? 'Accepted' : 'Rejected'}`,
      body: `${user.username} has ${accepted ? 'accepted' : 'rejected'} your contact request.`,
      icon: getPfpUrl(user),
      clickUrl: '/contacts',
    });

    return result;
  }

  async del(user: User | undefined, targetID: number): Promise<{ numDeletedRows: number }> {
    const contact = await this.getOne(user, targetID);

    const result = await kysely
      .deleteFrom('contact')
      .where('requesting_user', '=', contact.requesting_id!)
      .where('accepting_user', '=', contact.accepting_id!)
      .executeTakeFirstOrThrow();

    return { numDeletedRows: Number(result.numDeletedRows) };
  }

  async delByUsername(user: User | undefined, username: string): Promise<{ numDeletedRows: number }> {
    const target = await this.api.user.getOne({ 'user.username': username });
    return await this.del(user, target.id);
  }
}
