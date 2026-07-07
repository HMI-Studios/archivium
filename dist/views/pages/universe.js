"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = __importDefault(require("../../api"));
const utils_1 = require("../../api/utils");
const config_1 = require("../../config");
const embedding_1 = __importDefault(require("../../embedding"));
const errors_1 = require("../../errors");
const renderContent_1 = require("../../lib/renderContent");
const templates_1 = require("../../templates");
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
            const homePage = await api_1.default.item.getByUniverseAndItemShortnames(user, universe.shortname, '_home', utils_1.perms.READ, true).catch((0, utils_1.handleAsNull)([errors_1.ForbiddenError, errors_1.UnauthorizedError]));
            const renderedHomePage = homePage?.obj_data.body ? await (0, renderContent_1.tryRenderContent)(req, homePage?.obj_data.body, universe.shortname) : null;
            res.prepareRender('universe', { universe, authors: authorMap, threads, counts, totalItems, stories, couldUpgrade, accessRequest, homePage: renderedHomePage });
        }
        catch (err) {
            // If the user is not authorized to view the universe, check if there is a public page to display instead
            if (err instanceof errors_1.UnauthorizedError || err instanceof errors_1.ForbiddenError) {
                const publicPage = await api_1.default.universe.getPublicBodyByShortname(req.params.universeShortname);
                if (!publicPage && err instanceof errors_1.UnauthorizedError) {
                    res.status(401);
                    req.forceLogin = true;
                    // req.useExQuery = true; // TODO why is this here?
                    return;
                }
                return res.prepareRender('privateUniverse', { shortname: req.params.universeShortname, accessRequest, publicPage: await (0, renderContent_1.tryRenderContent)(req, publicPage, req.params.universeShortname) });
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
        const fetchedUniverse = await api_1.default.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, utils_1.perms.ADMIN);
        const universe = { ...fetchedUniverse, ...(req.body ?? {}), shortname: fetchedUniverse.shortname, newShort: req.body?.shortname ?? fetchedUniverse.shortname };
        const homePage = await api_1.default.item.getByUniverseAndItemShortnames(req.session.user, universe.shortname, '_home', utils_1.perms.READ, true).catch((0, utils_1.handleAsNull)(errors_1.ForbiddenError));
        const publicPage = await api_1.default.item.getByUniverseAndItemShortnames(req.session.user, universe.shortname, '_public', utils_1.perms.READ, true).catch((0, utils_1.handleAsNull)(errors_1.ForbiddenError));
        res.prepareRender('editUniverse', { universe, error: res.error, homePage, publicPage });
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
        const items = (await api_1.default.item.getByUniverseShortname(req.session.user, req.params.universeShortname, utils_1.perms.READ, {
            sort: req.getQueryParam('sort'),
            sortDesc: req.getQueryParam('sort_order') === 'desc',
            limit: req.getQueryParamAsNumber('limit'),
            type: req.getQueryParam('type'),
            tag: req.getQueryParam('tag'),
            author: req.getQueryParam('author'),
            search,
        })).filter(item => !item.shortname.startsWith('_'));
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
        const embeddingStats = await embedding_1.default.getStatsForUniverse(universe.id);
        res.prepareRender('universeAdmin', { universe, requests, invites, ownerCount, totalStoredImages, embeddingStats, tierLimits: utils_1.tierLimits[universe.tier ?? 0] });
    },
    async stats(req, res) {
        const universe = await api_1.default.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, utils_1.perms.WRITE);
        const cats = universe.obj_data['cats'] ?? {};
        const items = await api_1.default.item.getByUniverseShortname(req.session.user, universe.shortname, utils_1.perms.READ, { includeData: true });
        const tabData = await api_1.default.item.getUniverseTabData(universe);
        const { edges, deadLinks } = await api_1.default.item.getUniverseLinkStats(universe);
        let totalWords = 0;
        const edgeCounts = {};
        const wordCounts = [];
        const linkCounts = [];
        const tabPresence = [];
        const nodeTitles = {};
        for (const edge of edges) {
            if (!edgeCounts[edge.from])
                edgeCounts[edge.from] = { from: 0, to: 0 };
            edgeCounts[edge.from].from++;
            if (!edgeCounts[edge.to])
                edgeCounts[edge.to] = { from: 0, to: 0 };
            edgeCounts[edge.to].to++;
        }
        for (const item of items) {
            const objData = typeof item.obj_data === 'string' ? JSON.parse(item.obj_data) : item.obj_data;
            const words = objData.body?.text ? objData.body.text.trim().split(/\s+/).filter(Boolean).length : 0;
            totalWords += words;
            nodeTitles[item.shortname] = item.title;
            wordCounts.push({
                shortname: item.shortname,
                title: item.title,
                typeName: (cats[item.item_type] ?? [item.item_type])[0],
                typeColor: (cats[item.item_type] ?? [])[2],
                words,
            });
            linkCounts.push({
                shortname: item.shortname,
                title: item.title,
                from: edgeCounts[item.shortname]?.from ?? 0,
                to: edgeCounts[item.shortname]?.to ?? 0,
            });
            const tabState = (flagged, tabType) => {
                if (flagged)
                    return 'active';
                return tabData[tabType].has(item.id) ? 'hidden' : 'none';
            };
            tabPresence.push({
                shortname: item.shortname,
                title: item.title,
                tabs: {
                    gallery: tabState(!!objData.gallery?.title, 'gallery'),
                    lineage: tabState(!!objData.lineage?.title, 'lineage'),
                    timeline: tabState(!!objData.timeline?.title, 'timeline'),
                    map: tabState(!!objData.map?.title, 'map'),
                    notes: tabState(!!objData.notes, 'notes'),
                    comments: tabState(!!objData.comments, 'comments'),
                    custom: Object.keys(objData.tabs ?? {}).length > 0 ? 'active' : 'none',
                },
            });
        }
        wordCounts.sort((a, b) => b.words - a.words);
        linkCounts.sort((a, b) => a.from === b.from ? (a.to > b.to ? -1 : 1) : (a.from > b.from ? -1 : 1));
        res.prepareRender('universeStats', {
            universe,
            totalWords,
            wordCounts,
            tabPresence,
            tabTypes: ['gallery', 'lineage', 'timeline', 'map', 'notes', 'comments', 'custom'],
            nodeTitles,
            edges,
            deadLinks,
            linkCounts,
        });
    },
    async upgrade(req, res) {
        const universe = await api_1.default.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, utils_1.perms.ADMIN);
        const sponsoredData = await api_1.default.user.getSponsoredUniverses(req.session.user);
        const sponsored = sponsoredData.reduce((acc, row) => ({ ...acc, [row.tier]: row.universes.length }), {});
        res.prepareRender('upgradeUniverse', { universe, sponsored });
    },
};
