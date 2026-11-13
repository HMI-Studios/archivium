import { API } from '..';
import { kysely } from '../../db/kysely';
import { sql } from 'kysely';
import * as utils from '../../lib/hashUtils';
import crypto from 'crypto';
import { Trx } from '../../db/kysely';
import { withTransaction } from '../utils';
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
  metadata: Record<string, unknown> | null,
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

export type GrantUniverse = {
  universe_id: number,
  universe_shortname: string,
  universe_title: string,
  items_write: boolean,
  notes_write: boolean,
};

export type PersonalAccessTokenInfo = {
  id: number,
  token_hint: string,
  expires_at: Date | null,
  last_used_at: Date | null,
};

export type Grant = {
  user_id: number,
  client_id: string,
  client_name: string | null,
  created_at: Date,
  updated_at: Date,
  universes: GrantUniverse[],
  token: PersonalAccessTokenInfo | null,
};

export const PAT_PREFIX = 'arch_pat_';
const PAT_CLIENT_PREFIX = 'pat_';
export const MAX_PERSONAL_ACCESS_TOKENS = 25;

export function isPersonalAccessTokenClient(clientId: string): boolean {
  return clientId.startsWith(PAT_CLIENT_PREFIX);
}

function hashToken(token: string): string {
  return utils.createHash(token);
}

export type GrantUniverseInput = { universe_id: number, items_write: boolean, notes_write: boolean };

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

  async getGrants(userId: number, clientId?: string): Promise<Grant[]> {
    const grants = await kysely
      .selectFrom('oauth_grant')
      .innerJoin('oauth_client', 'oauth_client.client_id', 'oauth_grant.client_id')
      .leftJoin('personal_access_token as pat', 'pat.client_id', 'oauth_grant.client_id')
      .select([
        'oauth_grant.user_id', 'oauth_grant.client_id', 'oauth_client.client_name',
        'oauth_grant.created_at', 'oauth_grant.updated_at',
        'pat.id as pat_id', 'pat.token_hint', 'pat.expires_at', 'pat.last_used_at',
      ])
      .where('oauth_grant.user_id', '=', userId)
      .$if(clientId !== undefined, (qb) => qb.where('oauth_grant.client_id', '=', clientId!))
      .orderBy('oauth_grant.updated_at', 'desc')
      .execute();
    if (grants.length === 0) return [];

    const universeRows = await kysely
      .selectFrom('oauth_grant_universe')
      .innerJoin('universe', 'universe.id', 'oauth_grant_universe.universe_id')
      .select([
        'oauth_grant_universe.client_id', 'oauth_grant_universe.universe_id',
        'oauth_grant_universe.items_write', 'oauth_grant_universe.notes_write',
        'universe.shortname as universe_shortname', 'universe.title as universe_title',
      ])
      .where('oauth_grant_universe.user_id', '=', userId)
      .where('oauth_grant_universe.client_id', 'in', grants.map((g) => g.client_id))
      .orderBy('universe.title')
      .execute();

    return grants.map(({ pat_id, token_hint, expires_at, last_used_at, ...grant }) => ({
      ...grant,
      token: pat_id !== null && token_hint !== null
        ? { id: pat_id, token_hint, expires_at, last_used_at }
        : null,
      universes: universeRows
        .filter((row) => row.client_id === grant.client_id)
        .map(({ client_id: _clientId, ...row }) => ({
          ...row,
          items_write: Boolean(row.items_write),
          notes_write: Boolean(row.notes_write),
        })),
    }));
  }

  async getGrant(userId: number, clientId: string): Promise<Grant | undefined> {
    return (await this.getGrants(userId, clientId))[0];
  }

  async putGrant(userId: number, clientId: string, universes: GrantUniverseInput[]): Promise<void> {
    await withTransaction((trx) => this.writeGrant(trx, userId, clientId, universes));
  }

  private async writeGrant(trx: Trx, userId: number, clientId: string, universes: GrantUniverseInput[]): Promise<void> {
    const rows = universes
      .filter((u) => u.items_write || u.notes_write)
      .map((u) => ({
        user_id: userId,
        client_id: clientId,
        universe_id: u.universe_id,
        items_write: u.items_write,
        notes_write: u.notes_write,
      }));
    const now = new Date();
    await trx
      .insertInto('oauth_grant')
      .values({ user_id: userId, client_id: clientId, created_at: now, updated_at: now })
      .onDuplicateKeyUpdate({ updated_at: now })
      .execute();
    await trx
      .deleteFrom('oauth_grant_universe')
      .where('user_id', '=', userId)
      .where('client_id', '=', clientId)
      .execute();
    if (rows.length > 0) {
      await trx.insertInto('oauth_grant_universe').values(rows).execute();
    }
  }

  async revokeGrant(userId: number, clientId: string): Promise<void> {
    if (isPersonalAccessTokenClient(clientId)) {
      const owned = await kysely
        .selectFrom('personal_access_token')
        .select('id')
        .where('client_id', '=', clientId)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (owned) await kysely.deleteFrom('oauth_client').where('client_id', '=', clientId).execute();
      return;
    }
    await withTransaction(async (trx) => {
      for (const table of ['oauth_access_token', 'oauth_refresh_token', 'oauth_authorization_code', 'oauth_grant'] as const) {
        await trx.deleteFrom(table).where('user_id', '=', userId).where('client_id', '=', clientId).execute();
      }
    });
  }

  async countPersonalAccessTokens(userId: number): Promise<number> {
    const row = await kysely
      .selectFrom('personal_access_token')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async createPersonalAccessToken(
    userId: number,
    name: string,
    expiresAt: Date | null,
    universes: GrantUniverseInput[],
  ): Promise<string> {
    const token = `${PAT_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
    const clientId = `${PAT_CLIENT_PREFIX}${crypto.randomUUID()}`;
    const now = new Date();
    await withTransaction(async (trx) => {
      await trx
        .insertInto('oauth_client')
        .values({
          client_id: clientId,
          client_secret: null,
          client_secret_expires_at: null,
          client_name: name,
          redirect_uris: JSON.stringify([]),
          token_endpoint_auth_method: 'none',
          grant_types: JSON.stringify([]),
          response_types: JSON.stringify([]),
          scope: null,
          metadata: JSON.stringify({ personal_access_token: true }),
          created_at: now,
        })
        .execute();
      await trx
        .insertInto('personal_access_token')
        .values({
          user_id: userId,
          client_id: clientId,
          name,
          token_hash: hashToken(token),
          token_hint: token.slice(-4),
          expires_at: expiresAt,
          last_used_at: null,
          created_at: now,
        })
        .execute();
      await this.writeGrant(trx, userId, clientId, universes);
    });
    return token;
  }

  async verifyPersonalAccessToken(token: string): Promise<{ user_id: number, client_id: string, expires_at: Date | null } | undefined> {
    const row = await kysely
      .selectFrom('personal_access_token')
      .select(['id', 'user_id', 'client_id', 'expires_at', 'last_used_at'])
      .where('token_hash', '=', hashToken(token))
      .executeTakeFirst();
    if (!row) return undefined;
    if (row.expires_at && row.expires_at.getTime() < Date.now()) return undefined;
    // Avoid a write on every request; minute resolution is plenty for "last used".
    if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > 60 * 1000) {
      await kysely.updateTable('personal_access_token').set({ last_used_at: new Date() }).where('id', '=', row.id).execute();
    }
    return { user_id: row.user_id, client_id: row.client_id, expires_at: row.expires_at };
  }

  async purge(): Promise<void> {
    await kysely.deleteFrom('oauth_authorization_code').where('expires_at', '<', sql<Date>`NOW()`).execute();
    await kysely.deleteFrom('oauth_access_token').where('expires_at', '<', sql<Date>`NOW()`).execute();
    await kysely.deleteFrom('oauth_refresh_token').where('expires_at', '<', sql<Date>`NOW()`).execute();
  }
}
