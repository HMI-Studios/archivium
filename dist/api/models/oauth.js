"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OAuthAPI = void 0;
const utils_1 = require("../utils");
const hashUtils_1 = __importDefault(require("../../lib/hashUtils"));
const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
function newToken() {
    return hashUtils_1.default.createHash(hashUtils_1.default.createRandom32String());
}
function rowToClient(row) {
    return {
        ...(row.metadata ?? {}),
        client_id: row.client_id,
        client_secret: row.client_secret ?? undefined,
        client_secret_expires_at: row.client_secret_expires_at ?? undefined,
        client_name: row.client_name ?? undefined,
        redirect_uris: row.redirect_uris,
        token_endpoint_auth_method: row.token_endpoint_auth_method ?? undefined,
        grant_types: row.grant_types ?? undefined,
        response_types: row.response_types ?? undefined,
        scope: row.scope ?? undefined,
    };
}
class OAuthAPI {
    api;
    constructor(api) {
        this.api = api;
    }
    async getClient(clientId) {
        const rows = await (0, utils_1.executeQuery)('SELECT * FROM oauth_client WHERE client_id = ?', [clientId]);
        const row = rows[0];
        return row ? rowToClient(row) : undefined;
    }
    async registerClient(client) {
        const { client_id, client_secret, client_secret_expires_at, client_name, redirect_uris, token_endpoint_auth_method, grant_types, response_types, scope, ...metadata } = client;
        await (0, utils_1.executeQuery)(`INSERT INTO oauth_client (
        client_id, client_secret, client_secret_expires_at, client_name,
        redirect_uris, token_endpoint_auth_method, grant_types, response_types, scope, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            client_id,
            client_secret ?? null,
            client_secret_expires_at ?? null,
            client_name ?? null,
            JSON.stringify(redirect_uris),
            token_endpoint_auth_method ?? null,
            grant_types ? JSON.stringify(grant_types) : null,
            response_types ? JSON.stringify(response_types) : null,
            scope ?? null,
            Object.keys(metadata).length ? JSON.stringify(metadata) : null,
            new Date(),
        ]);
        return client;
    }
    async createAuthorizationCode(userId, clientId, params) {
        const code = newToken();
        await (0, utils_1.executeQuery)(`INSERT INTO oauth_authorization_code
        (code, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            code, clientId, userId, params.redirectUri, params.codeChallenge,
            params.scopes?.length ? params.scopes.join(' ') : null,
            params.resource?.href ?? null,
            new Date(Date.now() + AUTH_CODE_TTL_MS),
            new Date(),
        ]);
        return code;
    }
    async getAuthorizationCode(code) {
        const rows = await (0, utils_1.executeQuery)('SELECT * FROM oauth_authorization_code WHERE code = ?', [code]);
        const row = rows[0];
        if (!row || row.expires_at.getTime() < Date.now())
            return undefined;
        return row;
    }
    async consumeAuthorizationCode(code) {
        const authCode = await this.getAuthorizationCode(code);
        if (!authCode)
            return undefined;
        await (0, utils_1.executeQuery)('DELETE FROM oauth_authorization_code WHERE code = ?', [code]);
        return authCode;
    }
    async createAccessToken(userId, clientId, scope, resource) {
        const token = newToken();
        const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
        await (0, utils_1.executeQuery)(`INSERT INTO oauth_access_token (token, client_id, user_id, scope, resource, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [token, clientId, userId, scope, resource?.href ?? null, expiresAt, new Date()]);
        return { token, expiresAt };
    }
    async getAccessToken(token) {
        const rows = await (0, utils_1.executeQuery)('SELECT * FROM oauth_access_token WHERE token = ?', [token]);
        const row = rows[0];
        if (!row || row.expires_at.getTime() < Date.now())
            return undefined;
        return row;
    }
    async revokeAccessToken(token) {
        await (0, utils_1.executeQuery)('DELETE FROM oauth_access_token WHERE token = ?', [token]);
    }
    async createRefreshToken(userId, clientId, scope) {
        const token = newToken();
        await (0, utils_1.executeQuery)(`INSERT INTO oauth_refresh_token (token, client_id, user_id, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [token, clientId, userId, scope, new Date(Date.now() + REFRESH_TOKEN_TTL_MS), new Date()]);
        return token;
    }
    async getRefreshToken(token) {
        const rows = await (0, utils_1.executeQuery)('SELECT * FROM oauth_refresh_token WHERE token = ?', [token]);
        const row = rows[0];
        if (!row || row.expires_at.getTime() < Date.now())
            return undefined;
        return row;
    }
    async revokeRefreshToken(token) {
        await (0, utils_1.executeQuery)('DELETE FROM oauth_refresh_token WHERE token = ?', [token]);
    }
    async purge() {
        await (0, utils_1.executeQuery)('DELETE FROM oauth_authorization_code WHERE expires_at < NOW()');
        await (0, utils_1.executeQuery)('DELETE FROM oauth_access_token WHERE expires_at < NOW()');
        await (0, utils_1.executeQuery)('DELETE FROM oauth_refresh_token WHERE expires_at < NOW()');
    }
}
exports.OAuthAPI = OAuthAPI;
