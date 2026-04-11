"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = __importDefault(require("../../api"));
const utils_1 = require("../../api/utils");
const errors_1 = require("../../errors");
const familyTree_1 = require("../../lib/familyTree");
const renderContent_1 = require("../../lib/renderContent");
const templates_1 = require("../../templates");
exports.default = {
    async list(req, res) {
        const search = req.getQueryParam('search');
        const universes = await api_1.default.universe.getMany(req.session.user);
        const items = await api_1.default.item.getMany(req.session.user, null, Math.max(utils_1.perms.READ, Number(req.query.perms)) || utils_1.perms.READ, {
            sort: req.getQueryParam('sort'),
            sortDesc: req.getQueryParam('sort_order') === 'desc',
            limit: req.getQueryParamAsNumber('limit'),
            type: req.getQueryParam('type'),
            tag: req.getQueryParam('tag'),
            universe: req.getQueryParam('universe'),
            author: req.getQueryParam('author'),
            search,
        });
        const universeCats = universes.reduce((cats, universe) => {
            return { ...cats, [universe.id]: universe.obj_data['cats'] };
        }, {});
        const universe = req.query.universe ? await api_1.default.universe.getOne(req.session.user, { 'universe.shortname': req.query.universe }) : null;
        res.prepareRender('itemList', {
            items: items.map(item => ({ ...item, itemTypeName: ((universeCats[item.universe_id] ?? {})[item.item_type] ?? ['Missing Category'])[0] })),
            type: req.query.type,
            tag: req.query.tag,
            universe,
            author: req.query.author,
            showUniverse: true,
            search,
            layout: req.query.layout,
        });
    },
    async create(req, res) {
        const universe = await api_1.default.universe.getOne(req.session.user, { shortname: req.params.universeShortname }, utils_1.perms.WRITE);
        res.prepareRender('createItem', { universe, item_type: req.query.type, shortname: req.query.shortname });
    },
    async view(req, res) {
        const universe = await api_1.default.universe.getOne(req.session.user, { shortname: req.params.universeShortname });
        let item; // TODO this is ugly
        try {
            item = await api_1.default.item.getByUniverseAndItemShortnames(req.session.user, req.params.universeShortname, req.params.itemShortname);
        }
        catch (err) {
            if (err instanceof errors_1.ForbiddenError) {
                if (req.session.user && universe.author_permissions[req.session.user.id] >= utils_1.perms.READ) {
                    res.status(404);
                    res.prepareRender('error', {
                        code: 404,
                        hint: 'Looks like this item doesn\'t exist yet. Follow the link below to create it:',
                        hintLink: `${(0, templates_1.universeLink)(req, req.params.universeShortname)}/items/create?shortname=${req.params.itemShortname}`,
                    });
                    return;
                }
            }
            throw err;
        }
        ;
        item.itemTypeName = ((universe.obj_data['cats'] ?? {})[item.item_type] ?? ['Missing Category'])[0];
        item.itemTypeColor = ((universe.obj_data['cats'] ?? {})[item.item_type] ?? [, , '#f3f3f3'])[2];
        let renderedBody = { type: 'text', content: '' };
        if ('body' in item.obj_data) {
            renderedBody = await (0, renderContent_1.tryRenderContent)(req, item.obj_data.body, universe.shortname);
        }
        let family = {};
        let familyLayout = null;
        if ('lineage' in item.obj_data) {
            family = await api_1.default.item.getFamilyTree(req.session.user, item, 10);
            familyLayout = (0, familyTree_1.layoutFamilyTree)(item.shortname, family);
        }
        const [comments, commentUsers] = await api_1.default.discussion.getCommentsByItem(item.id, true);
        const commenters = {};
        for (const user of commentUsers) {
            user.pfpUrl = (0, utils_1.getPfpUrl)(user);
            delete user.email;
            commenters[user.id] = user;
        }
        const [notes, noteUsers] = await api_1.default.note.getByItemShortname(req.session.user, universe.shortname, item.shortname, {}, { connections: true }, true);
        const noteAuthors = {};
        for (const user of noteUsers) {
            user.pfpUrl = (0, utils_1.getPfpUrl)(user);
            delete user.email;
            noteAuthors[user.id] = user;
        }
        res.prepareRender('item', {
            item, universe, tab: req.query.tab, comments, commenters, notes, noteAuthors, renderedBody,
            commentAction: `${(0, templates_1.universeLink)(req, universe.shortname)}/items/${item.shortname}/comment`,
            noteBaseRoute: `/api/universes/${universe.shortname}/items/${item.shortname}/notes`,
            family, familyLayout,
        });
    },
    async delete(req, res) {
        try {
            const item = await api_1.default.item.getByUniverseAndItemShortnames(req.session.user, req.params.universeShortname, req.params.itemShortname, utils_1.perms.OWNER);
            res.prepareRender('deleteItem', { item });
        }
        catch (err) {
            if (err instanceof errors_1.NotFoundError) {
                return res.redirect(`${(0, templates_1.universeLink)(req, req.params.universeShortname)}/items`);
            }
            throw err;
        }
    },
};
