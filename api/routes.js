const { ADDR_PREFIX } = require('../config');
const Auth = require('../middleware/auth');
const api = require('./');

module.exports = function(app) {
  class APIRoute {
    constructor(path, methodFuncs, children) {
      this.path = path;
      this.methodFuncs = methodFuncs ?? {};
      this.children = children ?? [];
    }
  
    setup(parentPath) {
      const path = parentPath + this.path;
      app.options(path, async (req, res) => {
        res.setHeader('Access-Control-Allow-Methods', Object.keys(this.methodFuncs).join(','));
        return res.end();
      });
      // app.all(path, Auth.verifySession, async (req, res) => {
      app.all(path, async (req, res) => {
        const method = req.method.toUpperCase();
        if (method in this.methodFuncs) {
          const [status, data] = await this.methodFuncs[method](req);
          res.status(status);
          if (data !== undefined) return res.json(data);
        } else {
          return res.sendStatus(405);
        }
        return res.end();
      })
      for (const child of this.children) {
        child.setup(path);
      }
    }
  }
  
  async function frmtData(promise, callback) {
    const [status, data] = await promise;
    return [status, callback(data)];
  }

  app.use('/api', (req, res, next) => {
    res.set('Content-Type', 'application/json; charset=utf-8');
    next();
  })

  const apiRoutes = new APIRoute('/api', {}, [
    new APIRoute('/users', { GET: () => api.user.getMany() }, [
      new APIRoute('/:username', { GET: (req) => api.user.getOne({ username: req.params.username }) }, [
        new APIRoute('/universes', {
          GET: async (req) => {
            const [code, user] = await api.user.getOne({ username: req.params.username });
            if (code) return api.universe.getManyByAuthorId(req.session.user, user.id);
            else return [code];
          }
        }),
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
    new APIRoute('/universes', {
      GET: (req) => api.universe.getMany(req.session.user),
      POST: (req) => api.universe.post(req.session.user, req.body),
    }, [
      new APIRoute('/:universeShortName', {
        GET: (req) => api.universe.getOne(req.session.user, { shortname: req.params.universeShortName }),
        DELETE: (req) => api.universe.del(req.session.user, req.params.universeShortName),
      }, [
        new APIRoute('/items', {
          GET: (req) => api.item.getByUniverseShortname(req.session.user, req.params.universeShortName),
          POST: (req) => api.item.post(req.session.user, req.body, req.params.universeShortName),
        }, [
          new APIRoute('/:itemShortName', {
            GET: async (req) => api.item.getByUniverseAndItemShortnames(req.session.user, req.params.universeShortName, req.params.itemShortName),
            PUT: async (req) => api.item.save(req.session.user, req.params.universeShortName, req.params.itemShortName, req.body, true),
          }, [
            new APIRoute('/tags', {
              PUT: (req) => api.item.putTags(req.session.user, req.params.universeShortName, req.params.itemShortName, req.body.tags),
              DELETE: (req) => api.item.delTags(req.session.user, req.params.universeShortName, req.params.itemShortName, req.body.tags),
            }),
            new APIRoute('/snooze', {
              PUT: (req) => api.item.snoozeUntil(req.session.user, req.params.universeShortName, req.params.itemShortName),
            }),
          ])
        ])
      ])
    ]),
    new APIRoute('/exists', { POST: async (req) => {
      try {
        const tuples = [];
        for (const universe in req.body) {
          for (const item of req.body[universe]) {
            tuples.push([universe, item]);
          }
        }
        const results = await Promise.all(tuples.map(args => api.item.exists(req.session.user, ...args) ));
        const resultMap = {};
        for (let i = 0; i < results.length; i++) {
          const [code, data] = results[i];
          if (code !== 200) return [code];
          const [universe, item] = tuples[i];
          if (!(universe in resultMap)) resultMap[universe] = {};
          resultMap[universe][item] = data;
        }
        return [200, resultMap];
      } catch (err) {
        console.error(err);
        return [500];
      }
    }}),
  ]);

  apiRoutes.setup(ADDR_PREFIX);
}