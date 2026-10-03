import { API } from '..';
import { kysely } from '../../db/kysely';
import { sql } from 'kysely';
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
    const row = await kysely
      .selectFrom('oauth_client')
      .selectAll()
      .where('client_id', '=', clientId)
      .executeTakeFirst() as OAuthClientRow | undefined;
    return row ? rowToClient(row) : undefined;
  }

  async registerClient(client: OAuthClient): Promise<OAuthClient> {
    const {
      client_id, client_secret, client_secret_expires_at, client_name,
      redirect_uris, token_endpoint_auth_method, grant_types, response_types, scope,
      ...metadata
    } = client;
    await kysely
      .insertInto('oauth_client')
      .values({
        client_id,
        client_secret: client_secret ?? null,
        client_secret_expires_at: client_secret_expires_at ?? null,
        client_name: client_name ?? null,
        redirect_uris: JSON.stringify(redirect_uris),
        token_endpoint_auth_method: token_endpoint_auth_method ?? null,
        grant_types: grant_types ? JSON.stringify(grant_types) : null,
        response_types: response_types ? JSON.stringify(response_types) : null,
        scope: scope ?? null,
        metadata: Object.keys(metadata).length ? JSON.stringify(metadata) : null,
        created_at: new Date(),
      })
      .execute();
    return client;
  }

  async createAuthorizationCode(
    userId: number,
    clientId: string,
    params: { redirectUri: string, codeChallenge: string, scopes?: string[], resource?: URL },
  ): Promise<string> {
    const code = newToken();
    await kysely
      .insertInto('oauth_authorization_code')
      .values({
        code, client_id: clientId, user_id: userId,
        redirect_uri: params.redirectUri, code_challenge: params.codeChallenge,
        scope: params.scopes?.length ? params.scopes.join(' ') : null,
        resource: params.resource?.href ?? null,
        expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS),
        created_at: new Date(),
      })
      .execute();
    return code;
  }

  async getAuthorizationCode(code: string): Promise<AuthorizationCode | undefined> {
    const row = await kysely
      .selectFrom('oauth_authorization_code')
      .selectAll()
      .where('code', '=', code)
      .executeTakeFirst();
    if (!row || row.expires_at.getTime() < Date.now()) return undefined;
    return row;
  }

  async consumeAuthorizationCode(code: string): Promise<AuthorizationCode | undefined> {
    const authCode = await this.getAuthorizationCode(code);
    if (!authCode) return undefined;
    await kysely.deleteFrom('oauth_authorization_code').where('code', '=', code).execute();
    return authCode;
  }

  async createAccessToken(userId: number, clientId: string, scope: string | null, resource?: URL): Promise<{ token: string, expiresAt: Date }> {
    const token = newToken();
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
    await kysely
      .insertInto('oauth_access_token')
      .values({
        token, client_id: clientId, user_id: userId, scope,
        resource: resource?.href ?? null, expires_at: expiresAt, created_at: new Date(),
      })
      .execute();
    return { token, expiresAt };
  }

  async getAccessToken(token: string): Promise<AccessToken | undefined> {
    const row = await kysely
      .selectFrom('oauth_access_token')
      .selectAll()
      .where('token', '=', token)
      .executeTakeFirst();
    if (!row || row.expires_at.getTime() < Date.now()) return undefined;
    return row;
  }

  async revokeAccessToken(token: string): Promise<void> {
    await kysely.deleteFrom('oauth_access_token').where('token', '=', token).execute();
  }

  async createRefreshToken(userId: number, clientId: string, scope: string | null): Promise<string> {
    const token = newToken();
    await kysely
      .insertInto('oauth_refresh_token')
      .values({
        token, client_id: clientId, user_id: userId, scope,
        expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS), created_at: new Date(),
      })
      .execute();
    return token;
  }

  async getRefreshToken(token: string): Promise<RefreshToken | undefined> {
    const row = await kysely
      .selectFrom('oauth_refresh_token')
      .selectAll()
      .where('token', '=', token)
      .executeTakeFirst();
    if (!row || row.expires_at.getTime() < Date.now()) return undefined;
    return row;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    await kysely.deleteFrom('oauth_refresh_token').where('token', '=', token).execute();
  }

  async purge(): Promise<void> {
    await kysely.deleteFrom('oauth_authorization_code').where('expires_at', '<', sql<Date>`NOW()`).execute();
    await kysely.deleteFrom('oauth_access_token').where('expires_at', '<', sql<Date>`NOW()`).execute();
    await kysely.deleteFrom('oauth_refresh_token').where('expires_at', '<', sql<Date>`NOW()`).execute();
  }
}
