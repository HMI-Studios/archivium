import { Express, Handler, Request, Response } from 'express';
import { Multer } from 'multer';
import api from '.';
import { ADDR_PREFIX } from '../config';
import embedder from '../embedding';
import { NotFoundError } from '../errors';
import { tryRenderContent } from '../lib/renderContent';
import logger from '../logger';
import { Note } from './models/note';
import { Session } from './models/session';
import { User } from './models/user';
import { handleAsNull, perms, sendCachedImage } from './utils';

type RouteMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type APIRouteHandler = (req: Request<{ [key: string]: string }>, res: Response) => Promise<any>;
type MethodFuncs = {
  [method in RouteMethod]?: APIRouteHandler;
} & {
  middleware?: Handler[];
};

export default function (app: Express, upload: Multer) {
  class APIRoute {
    path: string;
    methodFuncs: MethodFuncs;
    children: APIRoute[];

    constructor(path: string, methodFuncs?: MethodFuncs, children?: APIRoute[]) {
      this.path = path;
      this.methodFuncs = methodFuncs ?? {};
      this.children = children ?? [];
    }

    setup(parentPath: string) {
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
            if (res.headersSent) return next(); // handler already fully responded (e.g. a 304 for a conditional GET)
            res.status(200);
            if (data !== undefined) {
              if (data instanceof Buffer) res.send(data);
              else res.json(data);
            } else res.json(null);
          } catch (err) {
            logger.error(err);
            res.status(err.code ?? 500);
            if (err.data) {
              res.json(err.data);
            } else {
              try {
                res.json(err.message);
              } catch (err) {
                logger.error(err);
                res.end();
              }
            }
          }
        } else {
          res.status(405);
        }
        next();
      })
      for (const child of this.children) {
        child.setup(path);
      }
    }
  }

  app.use('/api', (req, res, next) => {
    res.set('Content-Type', 'application/json; charset=utf-8');
    next();
  })

  const apiRoutes = new APIRoute('/api', {}, [
    new APIRoute('/*'),
    new APIRoute('/me', {
      GET: async (req) => req.session.user ? await api.user.getOne({ 'user.username': req.session.user.username }) : null,
    }),
    new APIRoute('/session-token', {
      GET: async (req) => {
        const { insertId } = await api.session.post();
        await api.session.put({ id: insertId }, { user_id: req.session.user?.id ?? null });
        const session = await api.session.getOne({ id: insertId }) as Session;
        return session.hash;
      },
    }),
    new APIRoute('/notifications', {}, [
      new APIRoute('/subscribe', { POST: (req) => api.notification.subscribe(req.session.user, req.body) }),
      new APIRoute('/unsubscribe', { POST: (req) => api.notification.unsubscribe(req.session.user, req.body) }),
      new APIRoute('/mark-all', { PUT: (req) => api.notification.markAllRead(req.session.user, req.body?.isRead ?? true) }),
      new APIRoute('/sent', {}, [
        new APIRoute('/:id', { PUT: (req) => api.notification.markRead(req.session.user, Number(req.params.id), req.body.isRead) }),
      ]),
    ]),
    new APIRoute('/is-subscribed', { POST: (req) => api.notification.isSubscribed(req.session.user, req.body) }),
    new APIRoute('/items', {
      GET: (req) => api.item.getMany(req.session.user, null, Math.max(perms.READ, Number(req.query.perms)) || perms.READ, {
        sort: req.getQueryParam('sort'),
        sortDesc: req.getQueryParam('sort_order') === 'desc',
        limit: req.getQueryParamAsNumber('limit'),
        type: req.getQueryParam('type'),
        tag: req.getQueryParam('tag'),
        author: req.getQueryParam('author'),
      }),
    }),
    new APIRoute('/users', { GET: () => api.user.getMany() }, [
      new APIRoute('/:username', {
        GET: async (req) => {
          const user = await api.user.getOne({ 'user.username': req.params.username });
          return req.session.user?.id === user.id ? user : api.user.toBasicUser(user);
        },
        DELETE: (req) => api.user.del(req.session.user, req.params.username, req.body.password),
      }, [
        new APIRoute('/send-verify-link', { GET: (req) => api.email.trySendVerifyLink(req.session.user, req.params.username) }),
        new APIRoute('/notes', {
          GET: (req) => api.note.getByUsername(req.session.user, req.params.username),
          POST: (req) => api.note.post(req.session.user, req.body),
        }, [
          new APIRoute('/:uuid', {
            GET: (req) => api.note.getOne(req.session.user, req.params.uuid)
              .then(async (note) => req.getQueryParam('renderBody') === '1' ? { ...note, body: await tryRenderContent(req, note.body, null) } : note),
            PUT: (req) => api.note.put(req.session.user, req.params.uuid, req.body),
            DELETE: (req) => api.note.del(req.session.user, req.params.uuid),
          }),
        ]),
        new APIRoute('/universes', {
          GET: async (req) => {
            const user = await api.user.getOne({ 'user.username': req.params.username }).catch(handleAsNull(NotFoundError));
            if (user) return api.universe.getManyByAuthorId(req.session.user, user.id);
            else return [];
          }
        }),
        new APIRoute('/pfp', {
          GET: (req, res) => api.user.image.getByUsername(req.params.username).then((image) => {
            return sendCachedImage(req, res, image, image?.id ?? 0, false);
          }),
          DELETE: (req) => api.user.image.del(req.session.user, req.params.username),
        }, [
          new APIRoute('/upload', {
            middleware: [upload.single('image')],
            POST: (req) => api.user.image.post(req.session.user, req.file, req.params.username),
          }),
        ]),
        new APIRoute('/username', { PUT: (req) => api.user.putUsername(req.session.user, req.params.username, req.body.username) }),
        new APIRoute('/email', { PUT: (req) => api.user.putEmail(req.session.user, req.params.username, req.body) }),
        new APIRoute('/password', { PUT: (req) => api.user.putPassword(req.session.user, req.params.username, req.body) }),
        new APIRoute('/notif-settings', { PUT: (req) => api.notification.putSettings((req.session?.user?.username === req.params.username) ? req.session.user : undefined, req.body.username) }),
        new APIRoute('/preferences', { PUT: (req) => api.user.putPreferences(req.session.user, req.params.username, req.body) }),
      ]),
    ]),
    new APIRoute('/contacts', {
      GET: (req) => api.contact.getAll(req.session.user),
      POST: (req) => api.contact.post(req.session.user, req.body.username),
      PUT: (req) => api.contact.put(req.session.user, req.body.username, req.body.accepted),
      DELETE: (req) => api.contact.delByUsername(req.session.user, req.body.username),
    }, [
      new APIRoute('/accepted', { GET: (req) => api.contact.getAll(req.session.user, false) }),
      new APIRoute('/pending', { GET: (req) => api.contact.getAll(req.session.user, true, false) }),
    ]),
    new APIRoute('/stories', {
      GET: (req) => api.story.getMany(req.session.user),
      POST: (req) => api.story.post(req.session.user, req.body),
    }, [
      new APIRoute('/:shortname', {
        GET: (req) => api.story.getOne(req.session.user, { 'story.shortname': req.params.shortname }),
        PUT: (req) => api.story.put(req.session.user, req.params.shortname, req.body),
        DELETE: (req) => api.story.del(req.session.user, req.params.shortname),
      }, [
        new APIRoute('/cover', {
          GET: (req, res) => api.story.cover.getByShortname(req.session.user, req.params.shortname).then((image) => {
            return sendCachedImage(req, res, image, image?.id ?? 0, false);
          }),
          DELETE: (req) => api.story.cover.del(req.session.user, req.params.shortname),
        }, [
          new APIRoute('/upload', {
            middleware: [upload.single('image')],
            POST: (req) => api.story.cover.post(req.session.user, req.file, req.params.shortname),
          }),
        ]),
        new APIRoute('/chapters', {}, [
          new APIRoute('/:index', {
            GET: (req) => api.story.getChapter(req.session.user, req.params.shortname, Number(req.params.index)),
            PUT: (req) => api.story.putChapter(req.session.user, req.params.shortname, Number(req.params.index), req.body),
            DELETE: (req) => api.story.delChapter(req.session.user, req.params.shortname, Number(req.params.index)),
          }, []),
        ]),
      ]),
    ]),
    new APIRoute('/universes', {
      GET: (req) => api.universe.getMany(req.session.user),
      POST: (req) => api.universe.post(req.session.user, req.body),
    }, [
      new APIRoute('/:universeShortName', {
        GET: (req) => api.universe.getOne(req.session.user, { shortname: req.params.universeShortName }),
        DELETE: (req) => api.universe.del(req.session.user, req.params.universeShortName),
      }, [
        new APIRoute('/notes', {
          GET: (req) => api.note.getBoardsByUniverseShortname(req.session.user, req.params.universeShortName),
          POST: (req) => api.note.postBoard(req.session.user, req.body, req.params.universeShortName),
        }, [
          new APIRoute('/:boardShortname', {
            GET: (req) => api.note.getByBoardShortname(req.session.user, req.params.boardShortname),
            POST: (req) => api.note.linkToBoard(req.session.user, req.params.boardShortname, req.body.uuid),
          }, [
            new APIRoute('/:uuid', {
              GET: (req) => api.note.getByBoardShortname(
                req.session.user,
                req.params.boardShortname,
                { 'note.uuid': req.params.uuid },
                { fullBody: true, connections: true, limit: 1 },
              )
                .then((notes: Note[]) => notes[0])
                .then(async (note) => req.getQueryParam('renderBody') === '1' ? { ...note, body: await tryRenderContent(req, note.body, null) } : note),
            }),
          ]),
        ]),
        new APIRoute('/items', {
          GET: (req) => api.item.getByUniverseShortname(req.session.user, req.params.universeShortName, Math.max(perms.READ, Number(req.query.perms)) || perms.READ, {
            sort: req.getQueryParam('sort'),
            sortDesc: req.getQueryParam('sort_order') === 'desc',
            limit: req.getQueryParamAsNumber('limit'),
            type: req.getQueryParam('type'),
            tag: req.getQueryParam('tag'),
            author: req.getQueryParam('author'),
          }),
          POST: (req) => api.item.post(req.session.user, req.body, req.params.universeShortName),
        }, [
          new APIRoute('/:itemShortName', {
            GET: (req) => api.item.getByUniverseAndItemShortnames(req.session.user, req.params.universeShortName, req.params.itemShortName),
            PUT: (req) => api.item.save(req.session.user, req.params.universeShortName, req.params.itemShortName, req.body),
            DELETE: (req) => api.item.del(req.session.user, req.params.universeShortName, req.params.itemShortName),
          }, [
            new APIRoute('/notes', {
              GET: (req) => api.note.getByItemShortname(req.session.user, req.params.universeShortName, req.params.itemShortName),
              POST: async (req) => {
                const uuid = await api.note.post(req.session.user, req.body);
                await api.note.linkToItem(req.session.user, req.params.universeShortName, req.params.itemShortName, uuid);
                return uuid;
              },
            }, [
              new APIRoute('/:uuid', {
                GET: (req) => api.note.getByItemShortname(
                  req.session.user,
                  req.params.universeShortName,
                  req.params.itemShortName,
                  { 'note.uuid': req.params.uuid },
                  { fullBody: true, connections: true, limit: 1 },
                )
                  .then((data: [Note[], User[]?]) => data[0][0])
                  .then(async (note) => req.getQueryParam('renderBody') === '1' ? { ...note, body: await tryRenderContent(req, note.body, null) } : note),
              }),
            ]),
            new APIRoute('/data', {
              PUT: (req) => api.item.putData(req.session.user, req.params.universeShortName, req.params.itemShortName, req.body),
            }),
            new APIRoute('/subscribe', {
              PUT: (req) => api.item.subscribeNotifs(req.session.user, req.params.universeShortName, req.params.itemShortName, req.body.isSubscribed),
            }),
            new APIRoute('/tags', {
              PUT: (req) => api.item.putTags(req.session.user, req.params.universeShortName, req.params.itemShortName, req.body.tags),
              DELETE: (req) => api.item.delTags(req.session.user, req.params.universeShortName, req.params.itemShortName, req.body.tags),
            }),
            new APIRoute('/snooze', {
              PUT: (req) => api.item.snoozeUntil(req.session.user, req.params.universeShortName, req.params.itemShortName),
            }),
            new APIRoute('/gallery', {}, [
              new APIRoute('/upload', {
                middleware: [upload.single('image')],
                POST: (req) => api.item.image.post(req.session.user, req.file, req.params.universeShortName, req.params.itemShortName),
              }),
              new APIRoute('/images', {
                GET: (req) => api.item.image.getManyByItemShort(req.session.user, req.params.universeShortName, req.params.itemShortName),
              }, [
                new APIRoute('/:id', {
                  GET: (req, res) => api.item.image.getOneByItemShort(req.session.user, req.params.universeShortName, req.params.itemShortName, { id: req.params.id })
                    .then((image) => {
                      return sendCachedImage(req, res, image, req.params.id, true);
                    }),
                  PUT: (req) => api.item.image.putLabel(req.session.user, Number(req.params.id), req.body.label),
                }),
              ]),
            ]),
            new APIRoute('/map', {}, [
              new APIRoute('/upload', {
                middleware: [upload.single('image')],
                POST: (req) => api.item.mapImage.post(req.session.user, req.file, req.params.universeShortName, req.params.itemShortName),
              }),
              new APIRoute('/image', {
                GET: (req, res) => api.item.mapImage.getOneByItemShort(req.session.user, req.params.universeShortName, req.params.itemShortName)
                  .then((image) => {
                    return sendCachedImage(req, res, image, image?.id ?? 0, false);
                  }),
              }),
            ]),
            new APIRoute('/comments', {
              GET: async (req) => {
                const item = await api.item.getByUniverseAndItemShortnames(req.session.user, req.params.universeShortName, req.params.itemShortName);
                return await api.discussion.getCommentsByItem(item.id);
              },
            }, [
              new APIRoute('/:commentId', {
                DELETE: (req) => api.discussion.deleteItemComment(req.session.user, req.params.universeShortName, req.params.itemShortName, Number(req.params.commentId)),
              }),
            ]),
          ]),
        ]),
        new APIRoute('/events', {
          GET: (req) => api.universe.getEventsByUniverseShortname(req.session.user, req.params.universeShortName),
        }, []),
        new APIRoute('/follow', {
          PUT: (req) => api.universe.putUserFollowing(req.session.user, req.params.universeShortName, req.body.isFollowing),
        }),
        new APIRoute('/discussion', {
          GET: (req) => api.discussion.getThreads(req.session.user, { 'universe.shortname': req.params.universeShortName }, false, true),
          // POST: (req) => api.discussion.postThread(req.session.user, req.params.universeShortName, req.body),
        }, [
          new APIRoute('/:discussionId', {
            GET: (req) => api.discussion.getCommentsByThread(req.session.user, Number(req.params.discussionId)),
          }, [
            new APIRoute('/:commentId', {
              DELETE: (req) => api.discussion.deleteThreadComment(req.session.user, Number(req.params.discussionId), Number(req.params.commentId)),
            }),
            new APIRoute('/subscribe', {
              PUT: (req) => api.discussion.subscribeToThread(req.session.user, Number(req.params.discussionId), req.body.isSubscribed),
            }),
          ]),
        ]),
        new APIRoute('/perms', {
          PUT: async (req) => {
            const user = await api.user.getOne({ 'user.username': req.body.username });
            return await api.universe.putPermissions(req.session.user, req.params.universeShortName, user, req.body.permissionLevel);
          },
        }),
        new APIRoute('/request', {
          PUT: (req) => api.universe.putAccessRequest(req.session.user, req.params.universeShortName, req.body.permissionLevel),
        }, [
          new APIRoute('/:requestingUser', {
            DELETE: async (req) => {
              const user = await api.user.getOne({ 'user.username': req.params.requestingUser ?? null });
              return await api.universe.delAccessRequest(req.session.user, req.params.universeShortName, user);
            },
          }),
        ]),
        new APIRoute('/invite', {}, [
          new APIRoute('/:username', {
            PUT: async (req) => {
              const target = await api.user.getOne({ 'user.username': req.params.username });
              await api.universe.putAccessInvite(req.session.user, req.params.universeShortName, target, req.body.permissionLevel);
            },
            DELETE: async (req) => {
              const user = await api.user.getOne({ 'user.username': req.params.username ?? null });
              return await api.universe.delAccessRequest(req.session.user, req.params.universeShortName, user);
            },
          }),
        ]),
      ]),
    ]),
    new APIRoute('/images', {}, [
      new APIRoute('/:id', {
        GET: (req, res) => api.image.get(req.session.user, Number(req.params.id))
          .then((image) => {
            return sendCachedImage(req, res, image, req.params.id, true);
          }),
      }),
    ]),
    new APIRoute('/semantic-search', {
      GET: async (req) => embedder.search(req.session.user, {
        ...req.query,
        query: (req.query.q ?? '') as string,
      }),
    }),
    new APIRoute('/writable-items', {
      GET: async (req) => api.item.getMany(req.session.user, null, perms.WRITE),
    }),
    new APIRoute('/exists', {
      POST: async (req) => {
        const body: { [universe: string]: string[] } = req.body;
        const tuples: [string, string][] = [];
        for (const universe in body) {
          for (const item of body[universe]) {
            tuples.push([universe, item]);
          }
        }
        const results = await Promise.all(tuples.map(args => api.item.exists(req.session.user, ...args))) as boolean[];
        const resultMap: { [universe: string]: { [item: string]: boolean } } = {};
        for (let i = 0; i < results.length; i++) {
          const [universe, item] = tuples[i];
          if (!(universe in resultMap)) resultMap[universe] = {};
          resultMap[universe][item] = results[i];
        }
        return resultMap;
      }
    }),
  ]);

  apiRoutes.setup(ADDR_PREFIX);
}
