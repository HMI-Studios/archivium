"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const config_1 = require("../config");
const auth_1 = __importDefault(require("../middleware/auth"));
const templates_1 = require("../templates");
const utils_1 = require("../api/utils");
const logger_1 = __importDefault(require("../logger"));
const ReCaptcha = __importStar(require("../middleware/reCaptcha"));
const theme_1 = __importDefault(require("../middleware/theme"));
const themes_1 = __importDefault(require("../themes"));
const pages_1 = __importDefault(require("./pages"));
const forms_1 = __importDefault(require("./forms"));
const errors_1 = require("../errors");
const axios_1 = require("axios");
const sites = {
    DISPLAY: (req) => !!req.headers['x-subdomain'],
    NORMAL: (req) => !req.headers['x-subdomain'],
    ALL: () => true,
};
function default_1(app) {
    app.use((req, res, next) => {
        req.getQueryParam = (key) => {
            const value = req.query[key];
            if (typeof value !== 'string' && value !== undefined) {
                throw new errors_1.RequestError(`Query parameter "${key}" is required and must be a string`, { code: axios_1.HttpStatusCode.BadRequest });
            }
            return value;
        };
        req.getQueryParamAsNumber = (key) => {
            const value = req.getQueryParam(key);
            if (value !== undefined && (value.trim() === '' || isNaN(Number(value)))) {
                throw new errors_1.RequestError(`Parameter ${key} expected to be numeric, but wasn't`, { code: axios_1.HttpStatusCode.BadRequest });
            }
            return Number(value);
        };
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.prepareRender = (template, data = {}) => {
            res.templateData = { template, data };
        };
        next();
    });
    app.use(theme_1.default);
    const doRender = async (req, res) => {
        if (res.statusCode === 302)
            return; // We did a redirect, no need to render.
        if (res.statusCode === 401) { // We don't have permission to be here, redirect to login page.
            const pageQuery = new URLSearchParams();
            if (req.useExQuery) {
                pageQuery.append('page', req.query.page);
                pageQuery.append('search', req.query.search);
            }
            else {
                const searchQueries = new URLSearchParams(req.query);
                pageQuery.append('page', req.targetPage ?? req.path);
                if (searchQueries.toString())
                    pageQuery.append('search', searchQueries.toString());
            }
            if (req.params.universeShortname && !req.forceLogin) {
                return res.redirect(`${(0, templates_1.universeLink)(req, req.params.universeShortname)}/?${pageQuery.toString()}`);
            }
            else {
                return res.redirect(`${config_1.ADDR_PREFIX}/login?${pageQuery.toString()}`);
            }
        }
        try {
            if (!res.templateData)
                throw `Code ${res.statusCode} returned by page handler.`;
            const { template, data } = res.templateData;
            res.end(await (0, templates_1.render)(req, template, data));
        }
        catch (err) {
            logger_1.default.error(`Error ${res.statusCode} rendered.`);
            logger_1.default.error(err);
            res.end(await (0, templates_1.render)(req, 'error', { code: res.statusCode }));
        }
    };
    function use(method, path, site, middleware, handler) {
        app[method](`${config_1.ADDR_PREFIX}${path}`, ...middleware, async (req, res, next) => {
            if (site(req) && !res.headersSent) {
                try {
                    await handler(req, res);
                }
                catch (err) {
                    logger_1.default.error(err);
                    if (err instanceof errors_1.RequestError) {
                        res.status(err.code);
                    }
                    else {
                        res.status(axios_1.HttpStatusCode.InternalServerError);
                    }
                }
                await doRender(req, res);
            }
            next();
        });
    }
    const get = (...args) => use('get', ...args);
    const post = (...args) => use('post', ...args);
    const subdomain = (page, params) => {
        return async (req, res) => {
            let subdomain = req.headers['x-subdomain'];
            if (subdomain instanceof Array) {
                subdomain = subdomain[0];
            }
            if (subdomain) {
                req.params = { ...req.params, ...params(subdomain) };
            }
            await page(req, res);
        };
    };
    const renderContext = (context, callback) => {
        const _use = (method, path, site, middleware, handler) => {
            use(method, path, site, middleware, async (req, res) => {
                await handler(req, res);
                await context(req, res);
            });
        };
        callback(_use.bind(null, 'get'), _use.bind(null, 'post'));
    };
    // TEMPORARY redirect
    get('/help/markdown', sites.ALL, [], async (_, res) => {
        res.redirect('https://github.com/HMI-Studios/archivium/wiki/Markdown-Guide');
    });
    get('/', sites.NORMAL, [], pages_1.default.misc.home);
    /* Terms and Agreements */
    get('/privacy-policy', sites.ALL, [], pages_1.default.misc.privacyPolicy);
    get('/terms-of-service', sites.ALL, [], pages_1.default.misc.termsOfService);
    get('/code-of-conduct', sites.ALL, [], pages_1.default.misc.codeOfConduct);
    /* User Pages */
    get('/contacts', sites.ALL, [auth_1.default.verifySessionOrRedirect], pages_1.default.user.contactList);
    get('/users/:username', sites.ALL, [], pages_1.default.user.profilePage);
    get('/settings', sites.ALL, [auth_1.default.bypassEmailVerification, auth_1.default.verifySessionOrRedirect], pages_1.default.user.settings);
    get('/verify', sites.ALL, [], pages_1.default.user.requestVerify);
    get('/verify/:key', sites.ALL, [], pages_1.default.user.verifyUser);
    get('/notifications', sites.ALL, [auth_1.default.verifySessionOrRedirect], pages_1.default.user.notifications);
    get('/forgot-password', sites.ALL, [], (_, res) => res.prepareRender('forgotPassword'));
    get('/reset-password/:key', sites.ALL, [], (_, res) => res.prepareRender('resetPassword'));
    /* Misc pages */
    get('/search', sites.ALL, [], pages_1.default.misc.search);
    get('/calendar-lab', sites.ALL, [], pages_1.default.misc.calendarLab);
    get('/news', sites.ALL, [], async (req, res) => {
        req.params.universeShortname = 'archivium';
        req.query.type = 'newsletter';
        req.query.sort = 'created_at';
        req.headers['x-subdomain'] = 'news';
        await pages_1.default.universe.itemList(req, res);
    });
    get('/news/:itemShortname', sites.ALL, [], async (req, res) => {
        req.params.universeShortname = 'archivium';
        req.headers['x-subdomain'] = 'news';
        await pages_1.default.item.view(req, res);
    });
    /* Note pages */
    get('/notes', sites.ALL, [auth_1.default.verifySessionOrRedirect], pages_1.default.misc.notes);
    /* Story pages */
    get('/stories', sites.ALL, [], pages_1.default.story.list);
    get('/stories/create', sites.ALL, [auth_1.default.verifySessionOrRedirect], pages_1.default.story.create);
    get('/stories/:shortname', sites.ALL, [], pages_1.default.story.view);
    get('/stories/:shortname/edit', sites.ALL, [auth_1.default.verifySessionOrRedirect], pages_1.default.story.edit);
    get('/stories/:shortname/delete', sites.ALL, [auth_1.default.verifySessionOrRedirect], pages_1.default.story.delete);
    get('/stories/:shortname/create', sites.ALL, [auth_1.default.verifySessionOrRedirect], pages_1.default.story.createChapter);
    get('/stories/:shortname/:index', sites.ALL, [], pages_1.default.story.viewChapter);
    get('/stories/:shortname/:index/delete', sites.ALL, [auth_1.default.verifySessionOrRedirect], pages_1.default.story.deleteChapter);
    get('/items', sites.NORMAL, [], pages_1.default.item.list);
    renderContext((req, res) => {
        if (res.templateData?.data?.universe) {
            const universe = res.templateData.data.universe;
            if (universe.tier < utils_1.tiers.PREMIUM)
                return;
            const themeName = universe.obj_data.theme;
            const customTheme = universe.obj_data.customTheme ?? {};
            const baseTheme = themes_1.default[themeName] ?? req.theme;
            req.theme = themeName === 'custom' ? customTheme : baseTheme;
        }
    }, (get, post) => {
        get('/editor', sites.ALL, [auth_1.default.verifySessionOrRedirect], pages_1.default.misc.editor);
        get('/editor/*', sites.ALL, [auth_1.default.verifySessionOrRedirect], pages_1.default.misc.editor);
        /* Universe Pages */
        get('/universes', sites.NORMAL, [], pages_1.default.universe.list);
        get('/universes/create', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], pages_1.default.universe.create);
        get('/universes/:universeShortname', sites.NORMAL, [], pages_1.default.universe.view);
        get('/universes/:universeShortname/edit', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], pages_1.default.universe.edit);
        get('/universes/:universeShortname/delete', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], pages_1.default.universe.delete);
        get('/universes/:universeShortname/discuss/create', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], pages_1.default.universe.createDiscussionThread);
        get('/universes/:universeShortname/discuss/:threadId', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], pages_1.default.universe.discussionThread);
        get('/universes/:universeShortname/items', sites.NORMAL, [], pages_1.default.universe.itemList);
        get('/universes/:universeShortname/upgrade', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], pages_1.default.universe.upgrade);
        get('/universes/:universeShortname/admin', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], pages_1.default.universe.admin);
        /* Item Pages */
        get('/universes/:universeShortname/items/create', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], pages_1.default.item.create);
        get('/universes/:universeShortname/items/:itemShortname', sites.NORMAL, [], pages_1.default.item.view);
        get('/universes/:universeShortname/items/:itemShortname/delete', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], pages_1.default.item.delete);
        /* Display Mode Pages */
        get('/', sites.DISPLAY, [], subdomain(pages_1.default.universe.view, (sub) => ({ universeShortname: sub })));
        get('/delete', sites.DISPLAY, [auth_1.default.verifySessionOrRedirect], subdomain(pages_1.default.universe.delete, (sub) => ({ universeShortname: sub })));
        get('/edit', sites.DISPLAY, [auth_1.default.verifySessionOrRedirect], subdomain(pages_1.default.universe.edit, (sub) => ({ universeShortname: sub })));
        get('/discuss/create', sites.DISPLAY, [auth_1.default.verifySessionOrRedirect], subdomain(pages_1.default.universe.createDiscussionThread, (sub) => ({ universeShortname: sub })));
        get('/discuss/:threadId', sites.DISPLAY, [], subdomain(pages_1.default.universe.discussionThread, (sub) => ({ universeShortname: sub })));
        get('/upgrade', sites.DISPLAY, [auth_1.default.verifySessionOrRedirect], subdomain(pages_1.default.universe.upgrade, (sub) => ({ universeShortname: sub })));
        get('/admin', sites.DISPLAY, [auth_1.default.verifySessionOrRedirect], subdomain(pages_1.default.universe.admin, (sub) => ({ universeShortname: sub })));
        get('/items', sites.DISPLAY, [], subdomain(pages_1.default.universe.itemList, (sub) => ({ universeShortname: sub })));
        get('/items/create', sites.DISPLAY, [auth_1.default.verifySessionOrRedirect], subdomain(pages_1.default.item.create, (sub) => ({ universeShortname: sub })));
        get('/items/:itemShortname', sites.DISPLAY, [], subdomain(pages_1.default.item.view, (sub) => ({ universeShortname: sub })));
        get('/items/:itemShortname/delete', sites.DISPLAY, [auth_1.default.verifySessionOrRedirect], subdomain(pages_1.default.item.delete, (sub) => ({ universeShortname: sub })));
        /* Universe POST Handlers */
        post('/universes/:universeShortname/edit', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], forms_1.default.editUniverse);
        post('/universes/:universeShortname/discuss/create', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], forms_1.default.createUniverseThread);
        post('/universes/:universeShortname/discuss/:threadId/comment', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], forms_1.default.commentOnThread);
        post('/universes/:universeShortname/upgrade', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], forms_1.default.sponsorUniverse);
        post('/universes/:universeShortname/items/create', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], forms_1.default.createItem);
        post('/universes/:universeShortname/items/:itemShortname/edit', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], () => { throw new errors_1.RequestError('This endpoint is deprecared.', { code: axios_1.HttpStatusCode.Gone }); });
        post('/universes/:universeShortname/items/:itemShortname/comment', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], forms_1.default.commentOnItem);
        post('/edit', sites.DISPLAY, [auth_1.default.verifySessionOrRedirect], subdomain(forms_1.default.editUniverse, (sub) => ({ universeShortname: sub })));
        post('/discuss/create', sites.DISPLAY, [auth_1.default.verifySessionOrRedirect], subdomain(forms_1.default.createUniverseThread, (sub) => ({ universeShortname: sub })));
        post('/discuss/:threadId/comment', sites.DISPLAY, [auth_1.default.verifySessionOrRedirect], subdomain(forms_1.default.commentOnThread, (sub) => ({ universeShortname: sub })));
        post('/upgrade', sites.DISPLAY, [auth_1.default.verifySessionOrRedirect], subdomain(forms_1.default.sponsorUniverse, (sub) => ({ universeShortname: sub })));
        post('/items/create', sites.DISPLAY, [auth_1.default.verifySessionOrRedirect], subdomain(forms_1.default.createItem, (sub) => ({ universeShortname: sub })));
        post('/items/:itemShortname/edit', sites.DISPLAY, [auth_1.default.verifySessionOrRedirect], () => { throw new errors_1.RequestError('This endpoint is deprecared.', { code: axios_1.HttpStatusCode.Gone }); });
        post('/items/:itemShortname/comment', sites.DISPLAY, [auth_1.default.verifySessionOrRedirect], subdomain(forms_1.default.commentOnItem, (sub) => ({ universeShortname: sub })));
    });
    // Redirect (for notification links)
    get('/universes/:universeShortname*', sites.DISPLAY, [], (req, res) => {
        res.redirect(`${(0, templates_1.universeLink)(req, req.params.universeShortname)}${req.params[0] || '/'}`);
    });
    /* POST Handlers */
    post('/settings/notifications', sites.ALL, [auth_1.default.verifySessionOrRedirect], forms_1.default.notificationSettings);
    post('/forgot-password', sites.ALL, [ReCaptcha.verifyReCaptcha], forms_1.default.passwordResetRequest);
    post('/reset-password/:key', sites.ALL, [], forms_1.default.resetPassword);
    post('/notes/create', sites.ALL, [auth_1.default.verifySessionOrRedirect], forms_1.default.createNote);
    post('/notes/edit', sites.ALL, [auth_1.default.verifySessionOrRedirect], forms_1.default.editNote);
    post('/stories/create', sites.ALL, [auth_1.default.verifySessionOrRedirect], forms_1.default.createStory);
    post('/stories/:shortname/edit', sites.ALL, [auth_1.default.verifySessionOrRedirect], forms_1.default.editStory);
    post('/stories/:shortname/:index/comment', sites.ALL, [auth_1.default.verifySessionOrRedirect], forms_1.default.commentOnChapter);
    post('/universes/create', sites.NORMAL, [auth_1.default.verifySessionOrRedirect], forms_1.default.createUniverse);
}
