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
const express_1 = __importDefault(require("express"));
const compression_1 = __importDefault(require("compression"));
const path_1 = __importDefault(require("path"));
const api_1 = __importDefault(require("./api"));
const templates_1 = require("./templates");
const cookieParser_1 = __importDefault(require("./middleware/cookieParser"));
const multer_1 = __importDefault(require("multer"));
const auth_1 = __importDefault(require("./middleware/auth"));
const ReCaptcha = __importStar(require("./middleware/reCaptcha"));
const node_cron_1 = __importDefault(require("node-cron"));
const backup_1 = __importDefault(require("./db/backup"));
// Logging
const logger_1 = __importDefault(require("./logger"));
const config_1 = require("./config");
// Hocuspocus Server
require("./hocuspocus");
logger_1.default.info('Server starting...');
const app = (0, express_1.default)();
app.use((0, compression_1.default)());
app.use(express_1.default.urlencoded({ extended: true }));
app.use(express_1.default.json());
app.use(cookieParser_1.default);
app.use(auth_1.default.createSession);
// Configure multer storage
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
});
// Cron Jobs
node_cron_1.default.schedule('0 0 * * *', () => {
    logger_1.default.info('Purging stale sessions...');
    api_1.default.session.purge().then(({ affectedRows }) => logger_1.default.info(`Purged ${affectedRows} sessions`));
    logger_1.default.info('Purging expired OAuth codes/tokens...');
    api_1.default.oauth.purge();
    logger_1.default.info('Running daily DB export...');
    (0, backup_1.default)();
});
// Timer
app.use('/', (req, res, next) => {
    req.startTime = new Date();
    next();
});
// IP Extraction
app.use('/', (req, res, next) => {
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (clientIp instanceof Array)
        clientIp = clientIp[0];
    // If the IP is in IPv6-mapped IPv4 format, extract the IPv4 part
    if (clientIp?.startsWith('::ffff:')) {
        clientIp = clientIp.split(':').pop();
    }
    req.clientIp = clientIp;
    next();
});
// Workers
app.use(`${config_1.ADDR_PREFIX}/notifworker.js`, express_1.default.static(path_1.default.join(__dirname, 'static/workers/notifworker.js')));
// Serve static assets
app.use(`${config_1.ADDR_PREFIX}/static`, express_1.default.static(path_1.default.join(__dirname, 'static/')));
// Load view routes
const views_1 = __importDefault(require("./views"));
(0, views_1.default)(app);
// Load api routes
const routes_1 = __importDefault(require("./api/routes"));
const utils_1 = require("./api/utils");
const errors_1 = require("./errors");
(0, routes_1.default)(app, upload);
// Load MCP server
const mcp_1 = __importDefault(require("./mcp"));
(0, mcp_1.default)(app);
/*
  ACCOUNT ROUTES
*/
async function logout(req, res) {
    await api_1.default.session.del({ id: req.session.id });
    res.clearCookie('archiviumuid');
}
app.get(`${config_1.ADDR_PREFIX}/login`, async (req, res, next) => {
    if (req.session.user) {
        try {
            await logout(req, res);
        }
        catch (err) {
            logger_1.default.error(err);
            res.sendStatus(500);
        }
    }
    res.end(await (0, templates_1.render)(req, 'login'));
    next();
});
app.get(`${config_1.ADDR_PREFIX}/signup`, async (req, res, next) => {
    res.end(await (0, templates_1.render)(req, 'signup'));
    next();
});
app.get(`${config_1.ADDR_PREFIX}/logout`, async (req, res, next) => {
    try {
        await logout(req, res);
        res.redirect(`${config_1.ADDR_PREFIX}/`);
    }
    catch (err) {
        logger_1.default.error(err);
        res.sendStatus(500);
    }
    next();
});
app.post(`${config_1.ADDR_PREFIX}/login`, async (req, res, next) => {
    try {
        const user = await api_1.default.user.getOne({ 'user.username': req.body.username }, true).catch((0, utils_1.handleAsNull)(errors_1.NotFoundError));
        if (user) {
            req.loginId = user.id;
            const isCorrectLogin = api_1.default.user.validatePassword(req.body.password, user.password, user.salt);
            if (isCorrectLogin) {
                await api_1.default.session.put({ id: req.session.id }, { user_id: req.loginId });
                res.status(200);
                res.redirect(`${config_1.ADDR_PREFIX}${req.query.page || '/'}${req.query.search ? `?${req.query.search}` : ''}`);
            }
            else {
                res.status(401);
                res.end(await (0, templates_1.render)(req, 'login', { error: 'Username or password incorrect.' }));
            }
        }
        else {
            res.status(401);
            res.end(await (0, templates_1.render)(req, 'login', { error: 'Username or password incorrect.' }));
        }
    }
    catch (err) {
        logger_1.default.error(err);
        res.sendStatus(500);
    }
    next();
});
app.post(`${config_1.ADDR_PREFIX}/signup`, ReCaptcha.verifyReCaptcha, async (req, res, next) => {
    try {
        const data = await api_1.default.user.post(req.body);
        try {
            await api_1.default.session.put({ id: req.session.id }, { user_id: data.insertId });
            res.status(201);
            if (!req.body.hp) {
                // Send verification email
                api_1.default.email.sendVerifyLink({ id: data.insertId, ...req.body });
            }
            if (!req.body.newsletter) {
                // TODO do something else here
                // api.email.unsubscribeUser([req.body.email], api.email.groups.NEWSLETTER);
            }
            res.redirect(`${config_1.ADDR_PREFIX}${req.query.page || '/'}${req.query.search ? `?${req.query.search}` : ''}`);
        }
        catch (err) {
            logger_1.default.error(err);
            res.sendStatus(500);
        }
    }
    catch (err) {
        logger_1.default.error(err);
        res.end(await (0, templates_1.render)(req, 'signup', { username: req.body.username, email: req.body.email, error: err }));
    }
    next();
});
// 404 errors
app.use(async (req, res, next) => {
    if (!res.headersSent) {
        res.status(404);
        if (req.isApiRequest)
            res.json({ error: 'Not Found.', code: 404 });
        else
            res.send(await (0, templates_1.render)(req, 'error', { code: 404 }));
    }
    next();
});
// Logger
app.use('/', (req, res, next) => {
    const endTime = new Date();
    const { method, path, query, session, startTime } = req;
    const user = session.user?.username ?? 'anonymous';
    logger_1.default.info(`${method} ${path} ${res.statusCode}${query ? ` ${JSON.stringify(query)}` : ''} ${user} ${req.clientIp} ${endTime.getTime() - startTime.getTime()}ms`);
    next();
});
const errorLogger = (err, req, res, next) => {
    logger_1.default.error(err);
    res.status(500);
    next();
};
app.use(errorLogger);
app.listen(config_1.PORT, () => {
    logger_1.default.info(`Server listening at http://localhost:${config_1.PORT}`);
});
