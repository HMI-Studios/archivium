import { executeQuery, parseData, getPfpUrl, handleAsNull } from '../utils';
import { API } from '..';
import { User } from './user';
import { ResultSetHeader } from 'mysql2/promise';
import { ModelError, NotFoundError, UnauthorizedError, ValidationError } from '../../errors';

export type ContactUser = User & {
  is_request: boolean,
  accepted: boolean,
  requesting_id?: number,
  accepting_id?: number,
};

export class ContactAPI {
  readonly api: API;

  constructor(api: API) {
    this.api = api;
  }

  async getOne(sessionUser: User | undefined, targetID: number): Promise<ContactUser> {
    if (!sessionUser) throw new UnauthorizedError();

    const queryString = `
      SELECT
        user.id,
        user.username,
        user.email,
        user.created_at,
        user.updated_at,
        (ui.user_id IS NOT NULL) as hasPfp,
        contact.accepted,
        (contact.accepting_user = ?) AS is_request,
        contact.requesting_user AS requesting_id,
        contact.accepting_user AS accepting_id
      FROM contact
      INNER JOIN user
      LEFT JOIN userimage AS ui ON user.id = ui.user_id
      WHERE
        user.id <> ?
        AND (
          user.id = contact.requesting_user
          OR user.id = contact.accepting_user
        )
        AND (
          (contact.requesting_user = ? AND contact.accepting_user = ?)
          OR (contact.accepting_user = ? AND contact.requesting_user = ?)
        );
    `;
    const user = (await executeQuery(queryString, [sessionUser.id, sessionUser.id, sessionUser.id, targetID, sessionUser.id, targetID]))[0] as ContactUser;
    if (!user) throw new NotFoundError();
    return user;
  }

  async getAll(user: User | undefined, includePending = true, includeAccepted = true): Promise<ContactUser[]> {
    if (!(includePending || includeAccepted)) throw new ValidationError('Either includePending or includeAccepted must be true');
    if (!user) throw new UnauthorizedError();

    const acceptClause = includePending === includeAccepted ? '' : `AND contact.accepted = ${includeAccepted}`;

    const queryString = `
      SELECT 
        user.id, user.username, user.email, user.created_at, user.updated_at, contact.accepted,
        (contact.accepting_user = ?) AS is_request, (ui.user_id IS NOT NULL) as hasPfp, userplan.plan
      FROM contact
      INNER JOIN user
      LEFT JOIN userimage AS ui ON user.id = ui.user_id
      LEFT JOIN userplan ON user.id = userplan.user_id
      WHERE 
        user.id <> ? 
        AND (
          user.id = contact.requesting_user
          OR user.id = contact.accepting_user
        )
        AND (contact.requesting_user = ? OR contact.accepting_user = ?)
        ${acceptClause};
    `;
    const users = await executeQuery(queryString, [user.id, user.id, user.id, user.id]) as ContactUser[];
    return users;
  }

  async post(user: User | undefined, username: string): Promise<ResultSetHeader> {
    if (!user) throw new UnauthorizedError();

    const target = await this.api.user.getOne({ 'user.username': username });
    if (!target) throw new NotFoundError();
    if (target.id === user.id) throw new ValidationError('Cannot contact yourself');
    const contact = await this.getOne(user, target.id).catch(handleAsNull(NotFoundError));
    if (contact) throw new ValidationError('Already a contact');

    let result: ResultSetHeader;
    const queryString = `
      INSERT INTO contact (
        requesting_user,
        accepting_user, 
        accepted
      ) VALUES (?, ?, ?);
    `;

    result = await executeQuery<ResultSetHeader>(queryString, [user.id, target.id, false]);

    await this.api.notification.notify(target, this.api.notification.types.CONTACTS, {
      title: 'Contact Request',
      body: `${user.username} has sent you a contact request.`,
      icon: getPfpUrl(user),
      clickUrl: '/contacts',
    });

    return result;
  }

  async put(user: User | undefined, username: string, accepted: boolean): Promise<ResultSetHeader> {
    if (!user) throw new UnauthorizedError();
    const target = await this.api.user.getOne({ 'user.username': username });
    const contact = await this.getOne(user, target.id);

    let result: ResultSetHeader;
    if (accepted) {
      result = await executeQuery<ResultSetHeader>(`
        UPDATE contact SET accepted = ?
        WHERE
          requesting_user = ${contact.requesting_id}
          AND accepting_user = ${contact.accepting_id};
      `, [true]);
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

  async del(user: User | undefined, targetID: number): Promise<ResultSetHeader> {

    const contact = await this.getOne(user, targetID);

    return await executeQuery<ResultSetHeader>(`
      DELETE FROM contact
      WHERE 
        requesting_user = ${contact.requesting_id}
        AND accepting_user = ${contact.accepting_id};
    `);
  }

  async delByUsername(user: User | undefined, username: string): Promise<ResultSetHeader> {
    const target = await this.api.user.getOne({ 'user.username': username });
    return await this.del(user, target.id);
  }
}
