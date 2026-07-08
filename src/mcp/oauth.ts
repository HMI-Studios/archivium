import { Response } from 'express';
import { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { AccessDeniedError, InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import api from '../api';
import { render } from '../templates';
import { ADDR_PREFIX } from '../config';

class ArchiviumClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
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
      res.redirect(`${ADDR_PREFIX}/login?${pageQuery.toString()}`);
      return;
    }

    if (req.method === 'POST') {
      if (req.body?.decision !== 'approve') {
        throw new AccessDeniedError('User denied the authorization request.');
      }
      const code = await api.oauth.createAuthorizationCode(req.session.user.id, client.client_id, params);
      const redirectUrl = new URL(params.redirectUri);
      redirectUrl.searchParams.set('code', code);
      if (params.state) redirectUrl.searchParams.set('state', params.state);
      res.redirect(302, redirectUrl.href);
      return;
    }

    // GET: show the consent screen; the form re-submits all original params as hidden fields.
    res.send(await render(req, 'mcpConsent', {
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
