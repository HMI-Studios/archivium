"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("../../config");
const api_1 = __importDefault(require("../../api"));
const templates_1 = require("../../templates");
const utils_1 = require("../../api/utils");
const errors_1 = require("../../errors");
exports.default = {
    async list(req, res) {
        const search = req.query.search;
        const universes = await api_1.default.universe.getMany(req.session.user, search ? { strings: ['title LIKE ?'], values: [`%${search}%`] } : null, utils_1.perms.READ, {
            sort: req.query.sort,
            sortDesc: req.query.sort_order === 'desc',
        });
        res.prepareRender('universeList', { universes, search, layout: req.query.layout });
    },
    async create(_, res) {
        res.prepareRender('createUniverse');
    },
    async view(req, res) {
        const user = req.session.user;
        const accessRequest = await api_1.default.universe.getUserAccessRequestIfExists(user, req.params.universeShortname).catch(() => null);
        try {
            const universe = await api_1.default.universe.getOne(user, { shortname: req.params.universeShortname });
            const authors = await api_1.default.user.getByUniverseShortname(user, universe.shortname);
            const authorMap = {};
            authors.forEach(author => {
                authorMap[author.id] = {
                    ...author,
                    pfpUrl: (0, utils_1.getPfpUrl)(author),
                };
            });
            const threads = await api_1.default.discussion.getThreads(user, { 'discussion.universe_id': universe.id }, false, true);
            const [counts, totalItems] = await api_1.default.item.getCountsByUniverse(user, universe, false);
            const stories = await api_1.default.story.getMany(user, { 'story.universe_id': universe.id });
            const sponsored = user ? await api_1.default.user.getSponsoredUniverses(user) : null;
            const couldUpgrade = sponsored ? (sponsored.length === 0 || sponsored
                .filter(row => row.tier > (universe.tier ?? 0))
            // .some(row => row.universes.length < tierAllowance[user.plan][row.tier])
            ) : false;
            res.prepareRender('universe', { universe, authors: authorMap, threads, counts, totalItems, stories, couldUpgrade, accessRequest });
        }
        catch (err) {
            // If the user is not authorized to view the universe, check if there is a public page to display instead
            if (err instanceof errors_1.UnauthorizedError || err instanceof errors_1.ForbiddenError) {
                const publicBody = await api_1.default.universe.getPublicBodyByShortname(req.params.universeShortname);
                if (!publicBody && err instanceof errors_1.UnauthorizedError) {
                    res.status(401);
                    req.forceLogin = true;
                    // req.useExQuery = true; // TODO why is this here?
                    return;
                }
                return res.prepareRender('privateUniverse', { shortname: req.params.universeShortname, accessRequest, publicBody });
            }
            throw err;
        }
    },
    async delete(req, res) {
        try {
            const universe = await api_1.default.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, utils_1.perms.OWNER);
            res.prepareRender('deleteUniverse', { universe });
        }
        catch (err) {
            if (err instanceof errors_1.NotFoundError) {
                return res.redirect(`${config_1.ADDR_PREFIX}/universes`);
            }
            throw err;
        }
    },
    async edit(req, res) {
        const fetchedUniverse = await api_1.default.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, utils_1.perms.WRITE);
        const universe = { ...fetchedUniverse, ...(req.body ?? {}), shortname: fetchedUniverse.shortname, newShort: req.body?.shortname ?? fetchedUniverse.shortname };
        res.prepareRender('editUniverse', { universe, error: res.error });
    },
    async createDiscussionThread(req, res) {
        if (!req.session.user)
            throw new errors_1.UnauthorizedError();
        const universe = await api_1.default.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, utils_1.perms.READ);
        if (!universe.discussion_enabled || !universe.discussion_open && universe.author_permissions[req.session.user.id] < utils_1.perms.COMMENT) {
            throw new errors_1.ForbiddenError();
        }
        res.prepareRender('createUniverseThread', { universe });
    },
    async discussionThread(req, res) {
        const universe = await api_1.default.universe.getOne(req.session.user, { shortname: req.params.universeShortname });
        const threads = await api_1.default.discussion.getThreads(req.session.user, {
            'discussion.id': req.params.threadId,
            'universe.id': universe.id,
        });
        if (threads.length === 0)
            throw new errors_1.NotFoundError();
        const thread = threads[0];
        const [comments, users] = await api_1.default.discussion.getCommentsByThread(req.session.user, thread.id, false, true);
        const commenters = {};
        for (const user of users) {
            user.pfpUrl = (0, utils_1.getPfpUrl)(user);
            delete user.email;
            commenters[user.id] = user;
        }
        res.prepareRender('universeThread', {
            universe, thread, comments, commenters,
            commentAction: `${(0, templates_1.universeLink)(req, universe.shortname)}/discuss/${thread.id}/comment`,
        });
    },
    async itemList(req, res) {
        const search = req.getQueryParam('search');
        const universe = await api_1.default.universe.getOne(req.session.user, { shortname: req.params.universeShortname });
        const items = await api_1.default.item.getByUniverseShortname(req.session.user, req.params.universeShortname, utils_1.perms.READ, {
            sort: req.getQueryParam('sort'),
            sortDesc: req.getQueryParam('sort_order') === 'desc',
            limit: req.getQueryParamAsNumber('limit'),
            type: req.getQueryParam('type'),
            tag: req.getQueryParam('tag'),
            author: req.getQueryParam('author'),
            search,
        });
        res.prepareRender('universeItemList', {
            items: items.map(item => ({ ...item, itemTypeName: ((universe.obj_data['cats'] ?? {})[item.item_type] ?? ['Missing Category'])[0] })),
            universe,
            type: req.query.type,
            tag: req.query.tag,
            search,
            layout: req.query.layout,
        });
    },
    async admin(req, res) {
        const universe = await api_1.default.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, utils_1.perms.ADMIN);
        const requests = await api_1.default.universe.getAccessRequests(req.session.user, req.params.universeShortname);
        const invites = await api_1.default.universe.getAccessInvites(req.session.user, req.params.universeShortname);
        let ownerCount = 0;
        for (const userID in universe.author_permissions) {
            if (universe.author_permissions[userID] === utils_1.perms.OWNER)
                ownerCount++;
        }
        const totalStoredImages = await api_1.default.universe.getTotalStoredByShortname(universe.shortname);
        res.prepareRender('universeAdmin', { universe, requests, invites, ownerCount, totalStoredImages, tierLimits: utils_1.tierLimits[universe.tier ?? 0] });
    },
    async upgrade(req, res) {
        const universe = await api_1.default.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, utils_1.perms.ADMIN);
        const sponsoredData = await api_1.default.user.getSponsoredUniverses(req.session.user);
        const sponsored = sponsoredData.reduce((acc, row) => ({ ...acc, [row.tier]: row.universes.length }), {});
        res.prepareRender('upgradeUniverse', { universe, sponsored });
    },
};
