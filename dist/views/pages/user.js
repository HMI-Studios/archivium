"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("../../config");
const api_1 = __importDefault(require("../../api"));
const md5_1 = __importDefault(require("md5"));
const utils_1 = require("../../api/utils");
const errors_1 = require("../../errors");
exports.default = {
    /* User Pages */
    async contactList(req, res) {
        const contacts = await api_1.default.contact.getAll(req.session.user);
        const gravatarContacts = contacts.map(user => ({
            ...user,
            pfpUrl: (0, utils_1.getPfpUrl)(user),
        }));
        res.prepareRender('contactList', {
            contacts: gravatarContacts.filter(contact => contact.accepted),
            pending: gravatarContacts.filter(contact => !contact.accepted),
        });
    },
    async profilePage(req, res) {
        const user = await api_1.default.user.getOne({ 'user.username': req.params.username });
        const universes = await api_1.default.universe.getManyByAuthorId(req.session.user, user.id);
        const recentlyUpdated = await api_1.default.item.getMany(req.session.user, null, utils_1.perms.READ, {
            sort: 'updated_at',
            sortDesc: true,
            limit: 15,
            select: [['lub.username', 'last_updated_by']],
            join: [['LEFT', ['user', 'lub'], new utils_1.Cond('lub.id = item.last_updated_by')]],
            where: new utils_1.Cond('lub.id = ?', user.id).or('item.last_updated_by IS NULL'),
        });
        const items = await api_1.default.item.getByAuthorUsername(req.session.user, user.username, utils_1.perms.READ, {
            sort: 'updated_at',
            sortDesc: true,
            limit: 15
        });
        if (!items)
            return;
        if (req.session.user?.id !== user.id) {
            const contact = await api_1.default.contact.getOne(req.session.user, user.id).catch((0, utils_1.handleAsNull)(errors_1.NotFoundError));
            user.isContact = contact !== null;
        }
        res.prepareRender('user', {
            user,
            items,
            pfpUrl: (0, utils_1.getPfpUrl)(user),
            universes,
            recentlyUpdated,
        });
    },
    async settings(req, res) {
        const user = await api_1.default.user.getOne({ 'user.id': req.session.user?.id });
        const typeSettingData = await api_1.default.notification.getTypeSettings(user);
        if (!typeSettingData)
            return;
        const typeSettings = {};
        for (const setting of typeSettingData) {
            typeSettings[`${setting.notif_type}_${setting.notif_method}`] = Boolean(setting.is_enabled);
        }
        const [, deleteRequest] = await api_1.default.user.getDeleteRequest(user);
        res.prepareRender('settings', {
            user,
            typeSettings,
            deleteRequest,
            notificationTypes: api_1.default.notification.types,
            notificationMethods: api_1.default.notification.methods,
        });
    },
    async requestVerify(req, res) {
        if (!req.session.user)
            throw new errors_1.UnauthorizedError();
        if (req.session.user.verified) {
            res.redirect(`${config_1.ADDR_PREFIX}/`);
            return;
        }
        const data = await api_1.default.email.trySendVerifyLink(req.session.user, req.session.user.username).catch(utils_1.handleErrorWithData);
        if (data && !(data instanceof Date) && data.alreadyVerified) {
            res.redirect(`${config_1.ADDR_PREFIX}${req.query.page || '/'}${req.query.search ? `?${req.query.search}` : ''}`);
            return;
        }
        res.prepareRender('verify', {
            user: req.session.user,
            gravatarLink: req.session.user.email && `https://www.gravatar.com/avatar/${(0, md5_1.default)(req.session.user.email)}.jpg`,
            nextPage: `${req.query.page || '/'}${req.query.search ? `?${req.query.search}` : ''}`,
            reason: req.query.reason,
        });
    },
    async verifyUser(req, res) {
        const userId = await api_1.default.user.verifyUser(req.params.key);
        const user = await api_1.default.user.getOne({ id: userId });
        try {
            // TODO should we send a welcome email?
            // api.email.sendTemplateEmail(api.email.templates.WELCOME, req.body.email, { username: user.username });
            return res.redirect(`${config_1.ADDR_PREFIX}/`);
        }
        catch (e) {
            if (e instanceof errors_1.NotFoundError) {
                return res.redirect(`${config_1.ADDR_PREFIX}/verify?reason=bad_key`);
            }
            throw e;
        }
    },
    async notifications(req, res) {
        if (req.session.user) {
            const notifications = await api_1.default.notification.getSentNotifications(req.session.user);
            if (!notifications)
                return;
            res.prepareRender('notifications', {
                read: notifications.filter(notif => notif.is_read),
                unread: notifications.filter(notif => !notif.is_read),
            });
        }
    },
};
