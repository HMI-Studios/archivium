import { ResultSetHeader } from 'mysql2/promise';
import express from 'express';
import path from 'path';
import api from './api';
import { render } from './templates';


import CookieParser from './middleware/cookieParser';
import multer from 'multer';
import Auth from './middleware/auth';
import * as ReCaptcha from './middleware/reCaptcha';

import cron from 'node-cron';
import backup from './db/backup';

// Logging
import logger from './logger';

import { PORT, ADDR_PREFIX } from './config';


// Hocuspocus Server
import './hocuspocus';


logger.info('Server starting...');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(CookieParser);
app.use(Auth.createSession);

// Configure multer storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});


// Cron Jobs
cron.schedule('0 0 * * *', () => {
  logger.info('Purging stale sessions...');
  api.session.purge().then(({ affectedRows }) => logger.info(`Purged ${affectedRows} sessions`));

  logger.info('Running daily DB export...');
  backup();
});


// Timer
app.use('/', (req, res, next) => {
  req.startTime = new Date();
  next();
});

// IP Extraction
app.use('/', (req, res, next) => {
  let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (clientIp instanceof Array) clientIp = clientIp[0];
  // If the IP is in IPv6-mapped IPv4 format, extract the IPv4 part
  if (clientIp?.startsWith('::ffff:')) {
    clientIp = clientIp.split(':').pop();
  }
  req.clientIp = clientIp;
  next();
});


// Workers
app.use(`${ADDR_PREFIX}/notifworker.js`, express.static(path.join(__dirname, 'static/workers/notifworker.js')));


// Serve static assets
app.use(`${ADDR_PREFIX}/static`, express.static(path.join(__dirname, 'static/')));

// Load view routes
import loadViews from './views';
loadViews(app);

// Load api routes
import loadRoutes from './api/routes';
import { handleAsNull } from './api/utils';
import { NotFoundError } from './errors';
loadRoutes(app, upload);


/*
  ACCOUNT ROUTES
*/
async function logout(req: express.Request, res: express.Response) {
  await api.session.del({ id: req.session.id });
  res.clearCookie('archiviumuid');
}

app.get(`${ADDR_PREFIX}/login`, async (req, res, next) => {
  if (req.session.user) {
    try {
      await logout(req, res);
    } catch (err) {
      logger.error(err);
      res.sendStatus(500);
    }
  }
  res.end(await render(req, 'login'));
  next();
});

app.get(`${ADDR_PREFIX}/signup`, async (req, res, next) => {
  res.end(await render(req, 'signup'));
  next();
});

app.get(`${ADDR_PREFIX}/logout`, async (req, res, next) => {
  try {
    await logout(req, res);
    res.redirect(`${ADDR_PREFIX}/`);
  } catch (err) {
    logger.error(err);
    res.sendStatus(500);
  }
  next();
});

app.post(`${ADDR_PREFIX}/login`, async (req, res, next) => {
  try {
    const user = await api.user.getOne({ 'user.username': req.body.username }, true).catch(handleAsNull(NotFoundError));
    if (user) {
      req.loginId = user.id;
      const isCorrectLogin = api.user.validatePassword(req.body.password, user.password, user.salt);
      if (isCorrectLogin) {
        await api.session.put({ id: req.session.id }, { user_id: req.loginId });
        res.status(200);
        res.redirect(`${ADDR_PREFIX}${req.query.page || '/'}${req.query.search ? `?${req.query.search}` : ''}`);
      } else {
        res.status(401);
        res.end(await render(req, 'login', { error: 'Username or password incorrect.' }));
      }
    } else {
      res.status(401);
      res.end(await render(req, 'login', { error: 'Username or password incorrect.' }));
    }
  } catch (err) {
    logger.error(err);
    res.sendStatus(500);
  }
  next();
});

app.post(`${ADDR_PREFIX}/signup`, ReCaptcha.verifyReCaptcha, async (req, res, next) => {
  try {
    const data = await api.user.post( req.body ) as ResultSetHeader;
    try {
      await api.session.put({ id: req.session.id }, { user_id: data.insertId });
      res.status(201);

      if (!req.body.hp) {
        // Send verification email
        api.email.sendVerifyLink({ id: data.insertId, ...req.body });
      }

      if (!req.body.newsletter) {
        // TODO do something else here
        // api.email.unsubscribeUser([req.body.email], api.email.groups.NEWSLETTER);
      }

      res.redirect(`${ADDR_PREFIX}${req.query.page || '/'}${req.query.search ? `?${req.query.search}` : ''}`);
    } catch (err) {
      logger.error(err);
      res.sendStatus(500);
    }
  } catch (err) {
    logger.error(err);
    res.end(await render(req, 'signup', { username: req.body.username, email: req.body.email, error: err }));
  }
  next();
});

// 404 errors
app.use(async (req, res, next) => {
  if (!res.headersSent) {
    res.status(404);
    if (req.isApiRequest) res.json({ error: 'Not Found.', code: 404 });
    else res.send(await render(req, 'error', { code: 404 }));
  }
  next();
});

// Logger
app.use('/', (req, res, next) => {
  const endTime = new Date();
  const { method, path, query, session, startTime } = req;
  const user = session.user?.username ?? 'anonymous';
  logger.info(`${method} ${path} ${res.statusCode}${query ? ` ${JSON.stringify(query)}` : ''} ${user} ${req.clientIp} ${endTime.getTime() - startTime.getTime()}ms`);
  next();
});

const errorLogger: express.ErrorRequestHandler = (err, req, res, next) => {
  logger.error(err);
  res.status(500);
  next();
};
app.use(errorLogger);

app.listen(PORT, () => {
  logger.info(`Server listening at http://localhost:${PORT}`);
});
