"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArchiviumOAuthProvider = void 0;
const errors_js_1 = require("@modelcontextprotocol/sdk/server/auth/errors.js");
const api_1 = __importDefault(require("../api"));
const templates_1 = require("../templates");
const config_1 = require("../config");
class ArchiviumClientsStore {
    async getClient(clientId) {
        return api_1.default.oauth.getClient(clientId);
    }
    async registerClient(client) {
        return api_1.default.oauth.registerClient(client);
    }
}
class ArchiviumOAuthProvider {
    clientsStore = new ArchiviumClientsStore();
    async authorize(client, params, res) {
        const req = res.req;
        if (!req.session.user || !req.session.user.verified) {
            const search = new URLSearchParams(req.query).toString();
            const pageQuery = new URLSearchParams();
            pageQuery.append('page', '/authorize');
            if (search)
                pageQuery.append('search', search);
            res.redirect(`${config_1.ADDR_PREFIX}/login?${pageQuery.toString()}`);
            return;
        }
        if (req.method === 'POST') {
            if (req.body?.decision !== 'approve') {
                throw new errors_js_1.AccessDeniedError('User denied the authorization request.');
            }
            const code = await api_1.default.oauth.createAuthorizationCode(req.session.user.id, client.client_id, params);
            const redirectUrl = new URL(params.redirectUri);
            redirectUrl.searchParams.set('code', code);
            if (params.state)
                redirectUrl.searchParams.set('state', params.state);
            res.redirect(302, redirectUrl.href);
            return;
        }
        // GET: show the consent screen; the form re-submits all original params as hidden fields.
        res.send(await (0, templates_1.render)(req, 'mcpConsent', {
            clientName: client.client_name || client.client_id,
            clientId: client.client_id,
            redirectUri: params.redirectUri,
            codeChallenge: params.codeChallenge,
            scope: params.scopes?.join(' '),
            state: params.state,
            resource: params.resource?.href,
        }));
    }
    async challengeForAuthorizationCode(client, authorizationCode) {
        const code = await api_1.default.oauth.getAuthorizationCode(authorizationCode);
        if (!code || code.client_id !== client.client_id) {
            throw new errors_js_1.InvalidGrantError('Invalid authorization code.');
        }
        return code.code_challenge;
    }
    async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri, resource) {
        const code = await api_1.default.oauth.consumeAuthorizationCode(authorizationCode);
        if (!code || code.client_id !== client.client_id) {
            throw new errors_js_1.InvalidGrantError('Invalid authorization code.');
        }
        if (redirectUri && redirectUri !== code.redirect_uri) {
            throw new errors_js_1.InvalidGrantError('redirect_uri does not match the authorization request.');
        }
        const { token, expiresAt } = await api_1.default.oauth.createAccessToken(code.user_id, client.client_id, code.scope, resource);
        const refreshToken = await api_1.default.oauth.createRefreshToken(code.user_id, client.client_id, code.scope);
        return {
            access_token: token,
            token_type: 'bearer',
            expires_in: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
            scope: code.scope ?? undefined,
            refresh_token: refreshToken,
        };
    }
    async exchangeRefreshToken(client, refreshToken, _scopes, resource) {
        const stored = await api_1.default.oauth.getRefreshToken(refreshToken);
        if (!stored || stored.client_id !== client.client_id) {
            throw new errors_js_1.InvalidGrantError('Invalid refresh token.');
        }
        // Rotate on every use: the old refresh token becomes single-use.
        await api_1.default.oauth.revokeRefreshToken(refreshToken);
        const { token, expiresAt } = await api_1.default.oauth.createAccessToken(stored.user_id, client.client_id, stored.scope, resource);
        const newRefreshToken = await api_1.default.oauth.createRefreshToken(stored.user_id, client.client_id, stored.scope);
        return {
            access_token: token,
            token_type: 'bearer',
            expires_in: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
            scope: stored.scope ?? undefined,
            refresh_token: newRefreshToken,
        };
    }
    async verifyAccessToken(token) {
        const stored = await api_1.default.oauth.getAccessToken(token);
        if (!stored) {
            throw new errors_js_1.InvalidTokenError('Access token is invalid or expired.');
        }
        return {
            token,
            clientId: stored.client_id,
            scopes: stored.scope ? stored.scope.split(' ') : [],
            expiresAt: Math.floor(stored.expires_at.getTime() / 1000),
            resource: stored.resource ? new URL(stored.resource) : undefined,
            extra: { userId: stored.user_id },
        };
    }
    async revokeToken(_client, request) {
        await Promise.all([
            api_1.default.oauth.revokeAccessToken(request.token),
            api_1.default.oauth.revokeRefreshToken(request.token),
        ]);
    }
}
exports.ArchiviumOAuthProvider = ArchiviumOAuthProvider;
