"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContactAPI = void 0;
const utils_1 = require("../utils");
const errors_1 = require("../../errors");
class ContactAPI {
    api;
    constructor(api) {
        this.api = api;
    }
    async getOne(sessionUser, targetID) {
        if (!sessionUser)
            throw new errors_1.UnauthorizedError();
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
        const user = (await (0, utils_1.executeQuery)(queryString, [sessionUser.id, sessionUser.id, sessionUser.id, targetID, sessionUser.id, targetID]))[0];
        if (!user)
            throw new errors_1.NotFoundError();
        return user;
    }
    async getAll(user, includePending = true, includeAccepted = true) {
        if (!(includePending || includeAccepted))
            throw new errors_1.ValidationError('Either includePending or includeAccepted must be true');
        if (!user)
            throw new errors_1.UnauthorizedError();
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
        const users = await (0, utils_1.executeQuery)(queryString, [user.id, user.id, user.id, user.id]);
        return users;
    }
    async post(user, username) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const target = await this.api.user.getOne({ 'user.username': username });
        if (!target)
            throw new errors_1.NotFoundError();
        if (target.id === user.id)
            throw new errors_1.ValidationError('Cannot contact yourself');
        const contact = await this.getOne(user, target.id).catch((0, utils_1.handleAsNull)(errors_1.NotFoundError));
        if (contact)
            throw new errors_1.ValidationError('Already a contact');
        let result;
        const queryString = `
      INSERT INTO contact (
        requesting_user,
        accepting_user, 
        accepted
      ) VALUES (?, ?, ?);
    `;
        result = await (0, utils_1.executeQuery)(queryString, [user.id, target.id, false]);
        await this.api.notification.notify(target, this.api.notification.types.CONTACTS, {
            title: 'Contact Request',
            body: `${user.username} has sent you a contact request.`,
            icon: (0, utils_1.getPfpUrl)(user),
            clickUrl: '/contacts',
        });
        return result;
    }
    async put(user, username, accepted) {
        if (!user)
            throw new errors_1.UnauthorizedError();
        const target = await this.api.user.getOne({ 'user.username': username });
        const contact = await this.getOne(user, target.id);
        let result;
        if (accepted) {
            result = await (0, utils_1.executeQuery)(`
        UPDATE contact SET accepted = ?
        WHERE
          requesting_user = ${contact.requesting_id}
          AND accepting_user = ${contact.accepting_id};
      `, [true]);
        }
        else {
            result = await this.del(user, target.id);
        }
        await this.api.notification.notify(target, this.api.notification.types.CONTACTS, {
            title: `Contact Request ${accepted ? 'Accepted' : 'Rejected'}`,
            body: `${user.username} has ${accepted ? 'accepted' : 'rejected'} your contact request.`,
            icon: (0, utils_1.getPfpUrl)(user),
            clickUrl: '/contacts',
        });
        return result;
    }
    async del(user, targetID) {
        const contact = await this.getOne(user, targetID);
        return await (0, utils_1.executeQuery)(`
      DELETE FROM contact
      WHERE 
        requesting_user = ${contact.requesting_id}
        AND accepting_user = ${contact.accepting_id};
    `);
    }
    async delByUsername(user, username) {
        const target = await this.api.user.getOne({ 'user.username': username });
        return await this.del(user, target.id);
    }
}
exports.ContactAPI = ContactAPI;
