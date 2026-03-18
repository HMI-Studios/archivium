"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DB_CONFIG = exports.VAPID_PRIVATE_KEY = exports.VAPID_PUBLIC_KEY = exports.WEB_PUSH_ENABLED = exports.ARCHIVIUM_DB = exports.ARCHIVIUM_DB_PASSWORD = exports.ARCHIVIUM_DB_USER = exports.ARCHIVIUM_DB_HOST = exports.LMSTER_KEY = exports.RECAPTCHA_KEY = exports.OPENAI_API_KEY = exports.MAILERSEND_API_KEY = exports.SITE_OWNER_EMAIL = exports.DEV_MODE = exports.ADDR_PREFIX = exports.DOMAIN = exports.PROVIDER_ADDRESS = exports.HOCUSPOCUS_PORT = exports.PORT = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function formatEnv(env) {
    env.PORT = Number(env.PORT);
    env.HOCUSPOCUS_PORT = Number(env.HOCUSPOCUS_PORT);
    env.DEV_MODE = env.DEV_MODE === 'true';
    env.WEB_PUSH_ENABLED = env.WEB_PUSH_ENABLED === 'true';
    return env;
}
_a = formatEnv({ ...process.env }), exports.PORT = _a.PORT, exports.HOCUSPOCUS_PORT = _a.HOCUSPOCUS_PORT, exports.PROVIDER_ADDRESS = _a.PROVIDER_ADDRESS, exports.DOMAIN = _a.DOMAIN, exports.ADDR_PREFIX = _a.ADDR_PREFIX, exports.DEV_MODE = _a.DEV_MODE, exports.SITE_OWNER_EMAIL = _a.SITE_OWNER_EMAIL, exports.MAILERSEND_API_KEY = _a.MAILERSEND_API_KEY, exports.OPENAI_API_KEY = _a.OPENAI_API_KEY, exports.RECAPTCHA_KEY = _a.RECAPTCHA_KEY, exports.LMSTER_KEY = _a.LMSTER_KEY, exports.ARCHIVIUM_DB_HOST = _a.ARCHIVIUM_DB_HOST, exports.ARCHIVIUM_DB_USER = _a.ARCHIVIUM_DB_USER, exports.ARCHIVIUM_DB_PASSWORD = _a.ARCHIVIUM_DB_PASSWORD, exports.ARCHIVIUM_DB = _a.ARCHIVIUM_DB, exports.WEB_PUSH_ENABLED = _a.WEB_PUSH_ENABLED, exports.VAPID_PUBLIC_KEY = _a.VAPID_PUBLIC_KEY, exports.VAPID_PRIVATE_KEY = _a.VAPID_PRIVATE_KEY;
exports.DB_CONFIG = {
    host: exports.ARCHIVIUM_DB_HOST,
    user: exports.ARCHIVIUM_DB_USER,
    password: exports.ARCHIVIUM_DB_PASSWORD,
    database: exports.ARCHIVIUM_DB,
};
