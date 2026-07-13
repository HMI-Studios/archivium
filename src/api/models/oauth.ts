import { API } from '..';
import { executeQuery } from '../utils';
import utils from '../../lib/hashUtils';
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

export type OAuthClient = {
  client_id: string,
  client_secret?: string,
  client_secret_expires_at?: number,
  client_name?: string,
  redirect_uris: string[],
  token_endpoint_auth_method?: string,
  grant_types?: string[],
  response_types?: string[],
  scope?: string,
} & Partial<OAuthClientInformationFull>;

type OAuthClientRow = {
  client_id: string,
  client_secret: string | null,
  client_secret_expires_at: number | null,
  client_name: string | null,
  redirect_uris: string[],
  token_endpoint_auth_method: string | null,
  grant_types: string[] | null,
  response_types: string[] | null,
  scope: string | null,
  metadata: Record<string, any> | null,
  created_at: Date,
};

export type AuthorizationCode = {
  code: string,
  client_id: string,
  user_id: number,
  redirect_uri: string,
  code_challenge: string,
  scope: string | null,
  resource: string | null,
  expires_at: Date,
};

export type AccessToken = {
  token: string,
  client_id: string,
  user_id: number,
  scope: string | null,
  resource: string | null,
  expires_at: Date,
};

export type RefreshToken = {
  token: string,
  client_id: string,
  user_id: number,
  scope: string | null,
  expires_at: Date,
};

const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function newToken(): string {
  return utils.createHash(utils.createRandom32String());
}

function rowToClient(row: OAuthClientRow): OAuthClient {
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

export class OAuthAPI {
  readonly api: API;

  constructor(api: API) {
    this.api = api;
  }

  async getClient(clientId: string): Promise<OAuthClient | undefined> {
    const rows = await executeQuery('SELECT * FROM oauth_client WHERE client_id = ?', [clientId]) as OAuthClientRow[];
    const row = rows[0];
    return row ? rowToClient(row) : undefined;
  }

  async registerClient(client: OAuthClient): Promise<OAuthClient> {
    const {
      client_id, client_secret, client_secret_expires_at, client_name,
      redirect_uris, token_endpoint_auth_method, grant_types, response_types, scope,
      ...metadata
    } = client;
    await executeQuery(
      `INSERT INTO oauth_client (
        client_id, client_secret, client_secret_expires_at, client_name,
        redirect_uris, token_endpoint_auth_method, grant_types, response_types, scope, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
      ],
    );
    return client;
  }

  async createAuthorizationCode(
    userId: number,
    clientId: string,
    params: { redirectUri: string, codeChallenge: string, scopes?: string[], resource?: URL },
  ): Promise<string> {
    const code = newToken();
    await executeQuery(
      `INSERT INTO oauth_authorization_code
        (code, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code, clientId, userId, params.redirectUri, params.codeChallenge,
        params.scopes?.length ? params.scopes.join(' ') : null,
        params.resource?.href ?? null,
        new Date(Date.now() + AUTH_CODE_TTL_MS),
        new Date(),
      ],
    );
    return code;
  }

  async getAuthorizationCode(code: string): Promise<AuthorizationCode | undefined> {
    const rows = await executeQuery('SELECT * FROM oauth_authorization_code WHERE code = ?', [code]) as AuthorizationCode[];
    const row = rows[0];
    if (!row || row.expires_at.getTime() < Date.now()) return undefined;
    return row;
  }

  async consumeAuthorizationCode(code: string): Promise<AuthorizationCode | undefined> {
    const authCode = await this.getAuthorizationCode(code);
    if (!authCode) return undefined;
    await executeQuery('DELETE FROM oauth_authorization_code WHERE code = ?', [code]);
    return authCode;
  }

  async createAccessToken(userId: number, clientId: string, scope: string | null, resource?: URL): Promise<{ token: string, expiresAt: Date }> {
    const token = newToken();
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
    await executeQuery(
      `INSERT INTO oauth_access_token (token, client_id, user_id, scope, resource, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [token, clientId, userId, scope, resource?.href ?? null, expiresAt, new Date()],
    );
    return { token, expiresAt };
  }

  async getAccessToken(token: string): Promise<AccessToken | undefined> {
    const rows = await executeQuery('SELECT * FROM oauth_access_token WHERE token = ?', [token]) as AccessToken[];
    const row = rows[0];
    if (!row || row.expires_at.getTime() < Date.now()) return undefined;
    return row;
  }

  async revokeAccessToken(token: string): Promise<void> {
    await executeQuery('DELETE FROM oauth_access_token WHERE token = ?', [token]);
  }

  async createRefreshToken(userId: number, clientId: string, scope: string | null): Promise<string> {
    const token = newToken();
    await executeQuery(
      `INSERT INTO oauth_refresh_token (token, client_id, user_id, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [token, clientId, userId, scope, new Date(Date.now() + REFRESH_TOKEN_TTL_MS), new Date()],
    );
    return token;
  }

  async getRefreshToken(token: string): Promise<RefreshToken | undefined> {
    const rows = await executeQuery('SELECT * FROM oauth_refresh_token WHERE token = ?', [token]) as RefreshToken[];
    const row = rows[0];
    if (!row || row.expires_at.getTime() < Date.now()) return undefined;
    return row;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    await executeQuery('DELETE FROM oauth_refresh_token WHERE token = ?', [token]);
  }

  async purge(): Promise<void> {
    await executeQuery('DELETE FROM oauth_authorization_code WHERE expires_at < NOW()');
    await executeQuery('DELETE FROM oauth_access_token WHERE expires_at < NOW()');
    await executeQuery('DELETE FROM oauth_refresh_token WHERE expires_at < NOW()');
  }
}
