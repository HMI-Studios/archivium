"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const cors_1 = __importDefault(require("cors"));
const _1 = __importDefault(require("."));
const config_1 = require("../config");
const errors_1 = require("../errors");
const logger_1 = __importDefault(require("../logger"));
const utils_1 = require("./utils");
function default_1(app, upload) {
    class APIRoute {
        path;
        methodFuncs;
        children;
        constructor(path, methodFuncs, children) {
            this.path = path;
            this.methodFuncs = methodFuncs ?? {};
            this.children = children ?? [];
        }
        setup(parentPath) {
            const path = parentPath + this.path;
            app.options(path, async (req, res, next) => {
                res.setHeader('Access-Control-Allow-Methods', Object.keys(this.methodFuncs).join(','));
                return next();
            });
            // app.all(path, Auth.verifySession, async (req, res) => {
            app.all(path, ...(this.methodFuncs.middleware ?? []), async (req, res, next) => {
                req.isApiRequest = true;
                const method = req.method.toUpperCase();
                if (method in this.methodFuncs) {
                    try {
                        const data = await this.methodFuncs[method](req, res);
                        res.status(200);
                        if (data !== undefined) {
                            if (data instanceof Buffer)
                                res.send(data);
                            else
                                res.json(data);
                        }
                        else
                            res.json(null);
                    }
                    catch (err) {
                        logger_1.default.error(err);
                        res.status(err.code ?? 500);
                        if (err.data) {
                            res.json(err.data);
                        }
                        else {
                            try {
                                res.json(err.message);
                            }
                            catch (err) {
                                logger_1.default.error(err);
                                res.end();
                            }
                        }
                    }
                }
                else {
                    res.status(405);
                }
                next();
            });
            for (const child of this.children) {
                child.setup(path);
            }
        }
    }
    app.use('/api', (req, res, next) => {
        res.set('Content-Type', 'application/json; charset=utf-8');
        next();
    });
    const isAllowedOrigin = (origin) => {
        if (!origin)
            return true;
        if (origin.startsWith('http://localhost') && config_1.DEV_MODE)
            return true;
        return config_1.CORS_ALLOWED_DOMAINS.some((domain) => {
            const regex = new RegExp(`^https?:\/\/([a-z0-9-]+\\.)*${domain.replace(/\./g, '\\.')}$`, "i");
            return regex.test(origin);
        });
    };
    app.use('/api', (0, cors_1.default)({
        origin: function (origin, callback) {
            if (isAllowedOrigin(origin))
                return callback(null, true);
            callback(new errors_1.ForbiddenError('Not allowed by CORS'));
        },
        credentials: true
    }));
    app.use('/api', (err, req, res, next) => {
        if (!err)
            return next();
        const code = err instanceof errors_1.RequestError ? err.code : 500;
        res.status(code).json({ error: err.message, code });
    });
    const apiRoutes = new APIRoute('/api', {}, [
        new APIRoute('/*'),
        new APIRoute('/me', {
            GET: async (req) => req.session.user ? await _1.default.user.getOne({ 'user.username': req.session.user.username }) : null,
        }),
        new APIRoute('/session-token', {
            GET: async (req) => {
                const { insertId } = await _1.default.session.post();
                await _1.default.session.put({ id: insertId }, { user_id: req.session.user?.id ?? null });
                const session = await _1.default.session.getOne({ id: insertId });
                return session.hash;
            },
        }),
        new APIRoute('/notifications', {}, [
            new APIRoute('/subscribe', { POST: (req) => _1.default.notification.subscribe(req.session.user, req.body) }),
            new APIRoute('/unsubscribe', { POST: (req) => _1.default.notification.unsubscribe(req.session.user, req.body) }),
            new APIRoute('/mark-all', { PUT: (req) => _1.default.notification.markAllRead(req.session.user, req.body?.isRead ?? true) }),
            new APIRoute('/sent', {}, [
                new APIRoute('/:id', { PUT: (req) => _1.default.notification.markRead(req.session.user, Number(req.params.id), req.body.isRead) }),
            ]),
        ]),
        new APIRoute('/is-subscribed', { POST: (req) => _1.default.notification.isSubscribed(req.session.user, req.body) }),
        new APIRoute('/users', { GET: () => _1.default.user.getMany() }, [
            new APIRoute('/:username', {
                GET: (req) => _1.default.user.getOne({ 'user.username': req.params.username }),
                DELETE: (req) => _1.default.user.del(req.session.user, req.params.username, req.body.password),
            }, [
                new APIRoute('/send-verify-link', { GET: (req) => _1.default.email.trySendVerifyLink(req.session.user, req.params.username) }),
                new APIRoute('/notes', {
                    GET: (req) => _1.default.note.getByUsername(req.session.user, req.params.username),
                    POST: (req) => _1.default.note.post(req.session.user, req.body),
                }, [
                    new APIRoute('/:uuid', {
                        GET: (req) => _1.default.note.getOne(req.session.user, req.params.uuid),
                        DELETE: (req) => _1.default.note.del(req.session.user, req.params.uuid),
                    }),
                ]),
                new APIRoute('/universes', {
                    GET: async (req) => {
                        const user = await _1.default.user.getOne({ 'user.username': req.params.username }).catch((0, utils_1.handleAsNull)(errors_1.NotFoundError));
                        if (user)
                            return _1.default.universe.getManyByAuthorId(req.session.user, user.id);
                        else
                            return [];
                    }
                }),
                new APIRoute('/pfp', {
                    GET: (req, res) => _1.default.user.image.getByUsername(req.params.username).then((image) => {
                        if (!image)
                            return;
                        res.contentType(image.mimetype);
                        if (req.query.download === '1')
                            res.setHeader('Content-Disposition', `attachment; filename="${image.name}"`);
                        return image?.data;
                    }),
                    DELETE: (req) => _1.default.user.image.del(req.session.user, req.params.username),
                }, [
                    new APIRoute('/upload', {
                        middleware: [upload.single('image')],
                        POST: (req) => _1.default.user.image.post(req.session.user, req.file, req.params.username),
                    }),
                ]),
                new APIRoute('/username', { PUT: (req) => _1.default.user.putUsername(req.session.user, req.params.username, req.body.username) }),
                new APIRoute('/email', { PUT: (req) => _1.default.user.putEmail(req.session.user, req.params.username, req.body) }),
                new APIRoute('/password', { PUT: (req) => _1.default.user.putPassword(req.session.user, req.params.username, req.body) }),
                new APIRoute('/notif-settings', { PUT: (req) => _1.default.notification.putSettings((req.session?.user?.username === req.params.username) ? req.session.user : undefined, req.body.username) }),
                new APIRoute('/preferences', { PUT: (req) => _1.default.user.putPreferences(req.session.user, req.params.username, req.body) }),
            ]),
        ]),
        new APIRoute('/contacts', {
            GET: (req) => _1.default.contact.getAll(req.session.user),
            POST: (req) => _1.default.contact.post(req.session.user, req.body.username),
            PUT: (req) => _1.default.contact.put(req.session.user, req.body.username, req.body.accepted),
            DELETE: (req) => _1.default.contact.delByUsername(req.session.user, req.body.username),
        }, [
            new APIRoute('/accepted', { GET: (req) => _1.default.contact.getAll(req.session.user, false) }),
            new APIRoute('/pending', { GET: (req) => _1.default.contact.getAll(req.session.user, true, false) }),
        ]),
        new APIRoute('/stories', {
            GET: (req) => _1.default.story.getMany(req.session.user),
            POST: (req) => _1.default.story.post(req.session.user, req.body),
        }, [
            new APIRoute('/:shortname', {
                GET: (req) => _1.default.story.getOne(req.session.user, { 'story.shortname': req.params.shortname }),
                PUT: (req) => _1.default.story.put(req.session.user, req.params.shortname, req.body),
                DELETE: (req) => _1.default.story.del(req.session.user, req.params.shortname),
            }, [
                new APIRoute('/cover', {
                    GET: (req, res) => _1.default.story.cover.getByShortname(req.session.user, req.params.shortname).then((image) => {
                        if (!image)
                            return;
                        res.contentType(image.mimetype);
                        if (req.query.download === '1')
                            res.setHeader('Content-Disposition', `attachment; filename="${image.name}"`);
                        return image?.data;
                    }),
                    DELETE: (req) => _1.default.story.cover.del(req.session.user, req.params.shortname),
                }, [
                    new APIRoute('/upload', {
                        middleware: [upload.single('image')],
                        POST: (req) => _1.default.story.cover.post(req.session.user, req.file, req.params.shortname),
                    }),
                ]),
                new APIRoute('/chapters', {}, [
                    new APIRoute('/:index', {
                        GET: (req) => _1.default.story.getChapter(req.session.user, req.params.shortname, Number(req.params.index)),
                        PUT: (req) => _1.default.story.putChapter(req.session.user, req.params.shortname, Number(req.params.index), req.body),
                        DELETE: (req) => _1.default.story.delChapter(req.session.user, req.params.shortname, Number(req.params.index)),
                    }, []),
                ]),
            ]),
        ]),
        new APIRoute('/universes', {
            GET: (req) => _1.default.universe.getMany(req.session.user),
            POST: (req) => _1.default.universe.post(req.session.user, req.body),
        }, [
            new APIRoute('/:universeShortName', {
                GET: (req) => _1.default.universe.getOne(req.session.user, { shortname: req.params.universeShortName }),
                DELETE: (req) => _1.default.universe.del(req.session.user, req.params.universeShortName),
            }, [
                new APIRoute('/notes', {
                    GET: (req) => _1.default.note.getBoardsByUniverseShortname(req.session.user, req.params.universeShortName),
                    POST: (req) => _1.default.note.postBoard(req.session.user, req.body, req.params.universeShortName),
                }, [
                    new APIRoute('/:boardShortname', {
                        GET: (req) => _1.default.note.getByBoardShortname(req.session.user, req.params.boardShortname),
                        POST: (req) => _1.default.note.linkToBoard(req.session.user, req.params.boardShortname, req.body.uuid),
                    }, [
                        new APIRoute('/:uuid', {
                            GET: (req) => _1.default.note.getByBoardShortname(req.session.user, req.params.boardShortname, { 'note.uuid': req.params.uuid }, { fullBody: true, connections: true, limit: 1 }).then((notes) => notes[0]),
                        }),
                    ]),
                ]),
                new APIRoute('/items', {
                    GET: (req) => _1.default.item.getByUniverseShortname(req.session.user, req.params.universeShortName, Math.max(utils_1.perms.READ, Number(req.query.perms)) || utils_1.perms.READ, {
                        sort: req.getQueryParam('sort'),
                        sortDesc: req.getQueryParam('sort_order') === 'desc',
                        limit: req.getQueryParamAsNumber('limit'),
                        type: req.getQueryParam('type'),
                        tag: req.getQueryParam('tag'),
                        author: req.getQueryParam('author'),
                    }),
                    POST: (req) => _1.default.item.post(req.session.user, req.body, req.params.universeShortName),
                }, [
                    new APIRoute('/:itemShortName', {
                        GET: (req) => _1.default.item.getByUniverseAndItemShortnames(req.session.user, req.params.universeShortName, req.params.itemShortName),
                        PUT: (req) => _1.default.item.save(req.session.user, req.params.universeShortName, req.params.itemShortName, req.body),
                        DELETE: (req) => _1.default.item.del(req.session.user, req.params.universeShortName, req.params.itemShortName),
                    }, [
                        new APIRoute('/notes', {
                            GET: (req) => _1.default.note.getByItemShortname(req.session.user, req.params.universeShortName, req.params.itemShortName),
                            POST: async (req) => {
                                const [code, data] = await _1.default.note.post(req.session.user, req.body);
                                if (!data)
                                    return [code];
                                const [, uuid] = data;
                                await _1.default.note.linkToItem(req.session.user, req.params.universeShortName, req.params.itemShortName, uuid);
                                return [code, data];
                            },
                        }, [
                            new APIRoute('/:uuid', {
                                GET: (req) => _1.default.note.getByItemShortname(req.session.user, req.params.universeShortName, req.params.itemShortName, { 'note.uuid': req.params.uuid }, { fullBody: true, connections: true, limit: 1 }).then((data) => data[0][0]),
                            }),
                        ]),
                        new APIRoute('/data', {
                            PUT: (req) => _1.default.item.putData(req.session.user, req.params.universeShortName, req.params.itemShortName, req.body),
                        }),
                        new APIRoute('/subscribe', {
                            PUT: (req) => _1.default.item.subscribeNotifs(req.session.user, req.params.universeShortName, req.params.itemShortName, req.body.isSubscribed),
                        }),
                        new APIRoute('/tags', {
                            PUT: (req) => _1.default.item.putTags(req.session.user, req.params.universeShortName, req.params.itemShortName, req.body.tags),
                            DELETE: (req) => _1.default.item.delTags(req.session.user, req.params.universeShortName, req.params.itemShortName, req.body.tags),
                        }),
                        new APIRoute('/snooze', {
                            PUT: (req) => _1.default.item.snoozeUntil(req.session.user, req.params.universeShortName, req.params.itemShortName),
                        }),
                        new APIRoute('/gallery', {}, [
                            new APIRoute('/upload', {
                                middleware: [upload.single('image')],
                                POST: (req) => _1.default.item.image.post(req.session.user, req.file, req.params.universeShortName, req.params.itemShortName),
                            }),
                            new APIRoute('/images', {
                                GET: (req) => _1.default.item.image.getManyByItemShort(req.session.user, req.params.universeShortName, req.params.itemShortName),
                            }, [
                                new APIRoute('/:id', {
                                    GET: (req, res) => _1.default.item.image.getOneByItemShort(req.session.user, req.params.universeShortName, req.params.itemShortName, { id: req.params.id })
                                        .then((image) => {
                                        if (!image)
                                            return;
                                        res.contentType(image.mimetype);
                                        if (req.query.download === '1')
                                            res.setHeader('Content-Disposition', `attachment; filename="${image.name}"`);
                                        return image.data;
                                    }),
                                    PUT: (req) => _1.default.item.image.putLabel(req.session.user, Number(req.params.id), req.body.label),
                                }),
                            ]),
                        ]),
                        new APIRoute('/map', {}, [
                            new APIRoute('/upload', {
                                middleware: [upload.single('image')],
                                POST: (req) => _1.default.item.mapImage.post(req.session.user, req.file, req.params.universeShortName, req.params.itemShortName),
                            }),
                            new APIRoute('/image', {
                                GET: (req, res) => _1.default.item.mapImage.getOneByItemShort(req.session.user, req.params.universeShortName, req.params.itemShortName)
                                    .then((image) => {
                                    if (!image)
                                        return;
                                    res.contentType(image.mimetype);
                                    if (req.query.download === '1')
                                        res.setHeader('Content-Disposition', `attachment; filename="${image.name}"`);
                                    return image.data;
                                }),
                            }),
                        ]),
                        new APIRoute('/comments', {
                            GET: async (req) => {
                                const item = await _1.default.item.getByUniverseAndItemShortnames(req.session.user, req.params.universeShortName, req.params.itemShortName);
                                return await _1.default.discussion.getCommentsByItem(item.id);
                            },
                        }, [
                            new APIRoute('/:commentId', {
                                DELETE: (req) => _1.default.discussion.deleteItemComment(req.session.user, req.params.universeShortName, req.params.itemShortName, Number(req.params.commentId)),
                            }),
                        ]),
                    ]),
                ]),
                new APIRoute('/events', {
                    GET: (req) => _1.default.universe.getEventsByUniverseShortname(req.session.user, req.params.universeShortName),
                }, []),
                new APIRoute('/follow', {
                    PUT: (req) => _1.default.universe.putUserFollowing(req.session.user, req.params.universeShortName, req.body.isFollowing),
                }),
                new APIRoute('/discussion', {
                    GET: (req) => _1.default.discussion.getThreads(req.session.user, { 'universe.shortname': req.params.universeShortName }, false, true),
                    // POST: (req) => api.discussion.postThread(req.session.user, req.params.universeShortName, req.body),
                }, [
                    new APIRoute('/:discussionId', {
                        GET: (req) => _1.default.discussion.getCommentsByThread(req.session.user, Number(req.params.discussionId)),
                    }, [
                        new APIRoute('/:commentId', {
                            DELETE: (req) => _1.default.discussion.deleteThreadComment(req.session.user, Number(req.params.discussionId), Number(req.params.commentId)),
                        }),
                        new APIRoute('/subscribe', {
                            PUT: (req) => _1.default.discussion.subscribeToThread(req.session.user, Number(req.params.discussionId), req.body.isSubscribed),
                        }),
                    ]),
                ]),
                new APIRoute('/perms', {
                    PUT: async (req) => {
                        const user = await _1.default.user.getOne({ 'user.username': req.body.username });
                        return await _1.default.universe.putPermissions(req.session.user, req.params.universeShortName, user, req.body.permissionLevel);
                    },
                }),
                new APIRoute('/request', {
                    PUT: (req) => _1.default.universe.putAccessRequest(req.session.user, req.params.universeShortName, req.body.permissionLevel),
                }, [
                    new APIRoute('/:requestingUser', {
                        DELETE: async (req) => {
                            const user = await _1.default.user.getOne({ 'user.username': req.params.requestingUser ?? null });
                            return await _1.default.universe.delAccessRequest(req.session.user, req.params.universeShortName, user);
                        },
                    }),
                ]),
                new APIRoute('/invite', {}, [
                    new APIRoute('/:username', {
                        PUT: async (req) => {
                            const target = await _1.default.user.getOne({ 'user.username': req.params.username });
                            await _1.default.universe.putAccessInvite(req.session.user, req.params.universeShortName, target, req.body.permissionLevel);
                        },
                        DELETE: async (req) => {
                            const user = await _1.default.user.getOne({ 'user.username': req.params.username ?? null });
                            return await _1.default.universe.delAccessRequest(req.session.user, req.params.universeShortName, user);
                        },
                    }),
                ]),
            ]),
        ]),
        new APIRoute('/images', {}, [
            new APIRoute('/:id', {
                GET: (req, res) => _1.default.image.get(req.session.user, Number(req.params.id))
                    .then((image) => {
                    if (!image)
                        return;
                    res.contentType(image.mimetype);
                    if (req.query.download === '1')
                        res.setHeader('Content-Disposition', `attachment; filename="${image.name}"`);
                    return image.data;
                }),
            }),
        ]),
        new APIRoute('/writable-items', {
            GET: async (req) => _1.default.item.getMany(req.session.user, null, utils_1.perms.WRITE),
        }),
        new APIRoute('/exists', {
            POST: async (req) => {
                const body = req.body;
                const tuples = [];
                for (const universe in body) {
                    for (const item of body[universe]) {
                        tuples.push([universe, item]);
                    }
                }
                const results = await Promise.all(tuples.map(args => _1.default.item.exists(req.session.user, ...args)));
                const resultMap = {};
                for (let i = 0; i < results.length; i++) {
                    const [universe, item] = tuples[i];
                    if (!(universe in resultMap))
                        resultMap[universe] = {};
                    resultMap[universe][item] = results[i];
                }
                return resultMap;
            }
        }),
    ]);
    apiRoutes.setup(config_1.ADDR_PREFIX);
}
