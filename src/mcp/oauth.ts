import { Response } from 'express';
import { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { AccessDeniedError, InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import api from '../api';
import { PAT_PREFIX, isPersonalAccessTokenClient } from '../api/models/oauth';
import { render } from '../templates';
import logger from '../logger';
import { grantableUniverses, parseGrantForm } from './grants';

class ArchiviumClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    if (isPersonalAccessTokenClient(clientId)) return undefined;
    return api.oauth.getClient(clientId) as Promise<OAuthClientInformationFull | undefined>;
  }

  async registerClient(client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>): Promise<OAuthClientInformationFull> {
    return api.oauth.registerClient(client as OAuthClientInformationFull) as Promise<OAuthClientInformationFull>;
  }
}

export class ArchiviumOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new ArchiviumClientsStore();

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const req = res.req;

    if (!req.session.user || !req.session.user.verified) {
      const search = new URLSearchParams(req.query as Record<string, string>).toString();
      const pageQuery = new URLSearchParams();
      pageQuery.append('page', '/authorize');
      if (search) pageQuery.append('search', search);
      res.redirect(`/login?${pageQuery.toString()}`);
      return;
    }

    const user = req.session.user;
    const grantable = await grantableUniverses(user);

    if (req.method === 'POST') {
      if (req.body?.decision !== 'approve') {
        throw new AccessDeniedError('User denied the authorization request.');
      }
      const universes = parseGrantForm(req.body, grantable);
      await api.oauth.putGrant(user.id, client.client_id, universes);
      logger.info(`MCP grant - user: ${user.id}, client: ${client.client_id}, write universes: ${JSON.stringify(universes)}`);
      const code = await api.oauth.createAuthorizationCode(user.id, client.client_id, params);
      const redirectUrl = new URL(params.redirectUri);
      redirectUrl.searchParams.set('code', code);
      if (params.state) redirectUrl.searchParams.set('state', params.state);
      res.redirect(302, redirectUrl.href);
      return;
    }

    // GET: show the consent screen; the form re-submits all original params as hidden fields.
    const existing = await api.oauth.getGrant(user.id, client.client_id);
    res.send(await render(req, 'mcpConsent', {
      grantable,
      existingGrant: existing ? Object.fromEntries(existing.universes.map((u) => [u.universe_id, u])) : {},
      clientName: client.client_name || client.client_id,
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scope: params.scopes?.join(' '),
      state: params.state,
      resource: params.resource?.href,
    }));
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const code = await api.oauth.getAuthorizationCode(authorizationCode);
    if (!code || code.client_id !== client.client_id) {
      throw new InvalidGrantError('Invalid authorization code.');
    }
    return code.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const code = await api.oauth.consumeAuthorizationCode(authorizationCode);
    if (!code || code.client_id !== client.client_id) {
      throw new InvalidGrantError('Invalid authorization code.');
    }
    if (redirectUri && redirectUri !== code.redirect_uri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request.');
    }

    const { token, expiresAt } = await api.oauth.createAccessToken(code.user_id, client.client_id, code.scope, resource);
    const refreshToken = await api.oauth.createRefreshToken(code.user_id, client.client_id, code.scope);

    return {
      access_token: token,
      token_type: 'bearer',
      expires_in: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
      scope: code.scope ?? undefined,
      refresh_token: refreshToken,
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const stored = await api.oauth.getRefreshToken(refreshToken);
    if (!stored || stored.client_id !== client.client_id) {
      throw new InvalidGrantError('Invalid refresh token.');
    }
    // Rotate on every use: the old refresh token becomes single-use.
    await api.oauth.revokeRefreshToken(refreshToken);

    const { token, expiresAt } = await api.oauth.createAccessToken(stored.user_id, client.client_id, stored.scope, resource);
    const newRefreshToken = await api.oauth.createRefreshToken(stored.user_id, client.client_id, stored.scope);

    return {
      access_token: token,
      token_type: 'bearer',
      expires_in: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
      scope: stored.scope ?? undefined,
      refresh_token: newRefreshToken,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (token.startsWith(PAT_PREFIX)) {
      const pat = await api.oauth.verifyPersonalAccessToken(token);
      if (!pat) throw new InvalidTokenError('Personal access token is invalid, expired or revoked.');
      return {
        token,
        clientId: pat.client_id,
        scopes: [],
        // The SDK requires an expiry. Tokens are re-verified on every request, so a
        // never-expiring token can just report a short rolling window.
        expiresAt: Math.floor((pat.expires_at?.getTime() ?? Date.now() + 60 * 60 * 1000) / 1000),
        extra: { userId: pat.user_id },
      };
    }
    const stored = await api.oauth.getAccessToken(token);
    if (!stored) {
      throw new InvalidTokenError('Access token is invalid or expired.');
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

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await Promise.all([
      api.oauth.revokeAccessToken(request.token),
      api.oauth.revokeRefreshToken(request.token),
    ]);
  }
}
