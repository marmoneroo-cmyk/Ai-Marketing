import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { Database } from '@brandpilot/db';
import type { ApiResponse } from '@brandpilot/core';
import { resetEnvCache } from '@brandpilot/config';
import { resetCryptoKeyCache } from '@brandpilot/connectors';
import { createOAuthState, readOAuthStateWithProvider } from '../common/oauth-state';

/**
 * Regression coverage for the "Connect Facebook" bug: `meta/start` +
 * `meta/callback` serve BOTH instagram and facebook, and the callback used to
 * hardcode `persistConnectedAccount(orgId, 'instagram', ...)` regardless of
 * which button the owner clicked — so a facebook connect would silently
 * persist `provider: 'instagram'` and a facebook account could never exist.
 *
 * `withOrgScope` is stubbed to run the handler's callback against a fake `tx`:
 * `query.organizations.findFirst` + `select(...)` back `assertChannelCapacity`
 * (start route only), and `insert(...)` records every `.values(...)` payload
 * per target table (compared by reference against the real, un-mocked table
 * objects) so a test can assert exactly what would have been persisted.
 * `MetaConnector.connect()` is real code hitting a stubbed `global.fetch`
 * (mirrors `google-oauth.controller.spec.ts`'s `stubGoogleFetch`), so the whole
 * start → callback round trip runs for real except the network + database.
 */
const { state } = vi.hoisted(() => ({
  state: {
    orgRow: { plan: 'free', settings: {} } as { plan: string; settings: unknown } | undefined,
    connectedCount: 0,
    insertedSocialAccounts: [] as Record<string, unknown>[],
    insertedTokens: [] as Record<string, unknown>[],
  },
}));

vi.mock('@brandpilot/db', async (importActual) => {
  const actual = await importActual<typeof import('@brandpilot/db')>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duck-typed fake query builder;
  // exists only to satisfy whatever chain shape the handler calls next.
  function selectChain(rows: unknown[]): any {
    const builder: any = {};
    const self = () => builder;
    builder.from = self;
    builder.where = self;
    builder.orderBy = self;
    builder.limit = self;
    builder.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject);
    return builder;
  }

  const tx = {
    query: {
      organizations: {
        findFirst: async () => state.orgRow,
      },
    },
    select: () => selectChain([{ value: state.connectedCount }]),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        if (table === actual.socialAccounts) {
          state.insertedSocialAccounts.push(vals);
          return { returning: async () => [{ id: 'social-account-1' }] };
        }
        if (table === actual.connectorTokens) {
          state.insertedTokens.push(vals);
          return { returning: async () => [{ id: 'token-1' }] };
        }
        return { returning: async () => [] };
      },
    }),
  };

  return {
    ...actual,
    withOrgScope: (_db: unknown, _orgId: string, cb: (t: unknown) => unknown) => cb(tx),
  };
});

import { ConnectorsController } from './connectors.controller';

const TEST_APP_URL = 'https://app.test.brandpilot.example';
const TEST_API_URL = 'https://api.test.brandpilot.example';
const AUTH_SECRET = 'x'.repeat(16);

/** Seed the env vars `loadEnv()` requires, mirroring `google-oauth.controller.spec.ts`. */
function seedTestEnv(): void {
  process.env.DATABASE_URL = 'postgres://localhost/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.AUTH_SECRET = AUTH_SECRET;
  process.env.TOKEN_ENCRYPTION_KEY = 'test-key';
  process.env.ANTHROPIC_API_KEY = 'test';
  process.env.VOYAGE_API_KEY = 'test';
  process.env.APP_URL = TEST_APP_URL;
  process.env.API_URL = TEST_API_URL;
  process.env.META_APP_ID = 'test-meta-app-id';
  process.env.META_APP_SECRET = 'test-meta-app-secret';
  resetEnvCache();
}

/** Fake Express Response that just records every `redirect(url)` call. */
function fakeResponse(): { res: Response; redirectedTo: string[] } {
  const redirectedTo: string[] = [];
  const res = { redirect: (url: string) => redirectedTo.push(url) } as unknown as Response;
  return { res, redirectedTo };
}

/** Stub global `fetch` to answer Meta's token-exchange + `me` identify endpoints. */
function stubMetaFetch(
  options: {
    tokenOk?: boolean;
    accessToken?: string;
    meOk?: boolean;
    me?: Record<string, unknown>;
  } = {},
): ReturnType<typeof vi.fn> {
  const {
    tokenOk = true,
    accessToken = 'meta-token-abc',
    meOk = true,
    me = { id: 'ext-123', username: 'lumina_biz', name: 'Lumina Biz' },
  } = options;

  const f = vi.fn(async (url: string) => {
    if (url.includes('graph.facebook.com/v21.0/oauth/access_token')) {
      return {
        ok: tokenOk,
        status: tokenOk ? 200 : 400,
        json: async () => (tokenOk ? { access_token: accessToken } : { error: { message: 'bad code' } }),
      };
    }
    if (url.includes('graph.facebook.com/v21.0/me')) {
      return {
        ok: meOk,
        status: meOk ? 200 : 400,
        json: async () => (meOk ? me : { error: { message: 'bad token' } }),
      };
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  vi.stubGlobal('fetch', f);
  return f;
}

/** Narrow the envelope's `{success:true}` branch, failing loudly otherwise. */
function expectSuccess<T>(response: ApiResponse<T>): T {
  if (!response.success) {
    throw new Error(
      `expected a success envelope, got error: ${response.error.code} — ${response.error.message}`,
    );
  }
  return response.data;
}

describe('ConnectorsController — Meta start/callback (instagram vs facebook)', () => {
  beforeEach(() => {
    seedTestEnv();
    state.orgRow = { plan: 'free', settings: {} };
    state.connectedCount = 0;
    state.insertedSocialAccounts = [];
    state.insertedTokens = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetEnvCache();
    resetCryptoKeyCache();
  });

  it('facebook start -> callback round-trip persists provider="facebook" (not instagram)', async () => {
    stubMetaFetch({ accessToken: 'fb-token-1', me: { id: 'page-1', name: 'Lumina Page' } });
    const controller = new ConnectorsController({} as unknown as Database);

    const { url } = expectSuccess(await controller.getMetaStart('org-1', 'facebook'));
    const stateParam = new URL(url).searchParams.get('state') ?? undefined;
    // The provider survives inside the signed state, not just the URL's own query string.
    expect(readOAuthStateWithProvider(stateParam, AUTH_SECRET)).toEqual({
      orgId: 'org-1',
      provider: 'facebook',
    });

    const { res, redirectedTo } = fakeResponse();
    await controller.getMetaCallback(res, 'auth-code-1', stateParam, undefined);

    expect(state.insertedSocialAccounts).toHaveLength(1);
    expect(state.insertedSocialAccounts[0]).toMatchObject({
      orgId: 'org-1',
      provider: 'facebook',
      externalId: 'page-1',
    });
    expect(state.insertedTokens).toHaveLength(1);
    expect(redirectedTo).toEqual([`${TEST_APP_URL}/settings?connected=facebook`]);
  });

  it('instagram start -> callback round-trip still persists provider="instagram" (unchanged)', async () => {
    stubMetaFetch({ accessToken: 'ig-token-1', me: { id: 'ig-1', username: 'lumina_ig' } });
    const controller = new ConnectorsController({} as unknown as Database);

    const { url } = expectSuccess(await controller.getMetaStart('org-2', 'instagram'));
    const stateParam = new URL(url).searchParams.get('state') ?? undefined;
    expect(readOAuthStateWithProvider(stateParam, AUTH_SECRET)).toEqual({
      orgId: 'org-2',
      provider: 'instagram',
    });

    const { res, redirectedTo } = fakeResponse();
    await controller.getMetaCallback(res, 'auth-code-2', stateParam, undefined);

    expect(state.insertedSocialAccounts[0]).toMatchObject({ orgId: 'org-2', provider: 'instagram' });
    expect(redirectedTo).toEqual([`${TEST_APP_URL}/settings?connected=instagram`]);
  });

  it('defaults a missing ?provider= at start to instagram', async () => {
    stubMetaFetch({});
    const controller = new ConnectorsController({} as unknown as Database);

    const { url } = expectSuccess(await controller.getMetaStart('org-3'));
    const stateParam = new URL(url).searchParams.get('state') ?? undefined;
    expect(readOAuthStateWithProvider(stateParam, AUTH_SECRET)).toEqual({
      orgId: 'org-3',
      provider: 'instagram',
    });
  });

  it('normalizes an unrecognized ?provider= to instagram, and the normalized value survives to the callback', async () => {
    stubMetaFetch({});
    const controller = new ConnectorsController({} as unknown as Database);

    const { url } = expectSuccess(await controller.getMetaStart('org-4', 'twitter'));
    const stateParam = new URL(url).searchParams.get('state') ?? undefined;
    expect(readOAuthStateWithProvider(stateParam, AUTH_SECRET)).toEqual({
      orgId: 'org-4',
      provider: 'instagram',
    });

    const { res, redirectedTo } = fakeResponse();
    await controller.getMetaCallback(res, 'auth-code-4', stateParam, undefined);

    expect(state.insertedSocialAccounts[0]).toMatchObject({ orgId: 'org-4', provider: 'instagram' });
    expect(redirectedTo).toEqual([`${TEST_APP_URL}/settings?connected=instagram`]);
  });

  it('a state issued with no bound provider (e.g. pre-existing/legacy) still defaults to instagram at the callback', async () => {
    stubMetaFetch({});
    const controller = new ConnectorsController({} as unknown as Database);
    const legacyState = createOAuthState('org-5', AUTH_SECRET); // no provider bound in

    const { res, redirectedTo } = fakeResponse();
    await controller.getMetaCallback(res, 'auth-code-5', legacyState, undefined);

    expect(state.insertedSocialAccounts[0]).toMatchObject({ orgId: 'org-5', provider: 'instagram' });
    expect(redirectedTo).toEqual([`${TEST_APP_URL}/settings?connected=instagram`]);
  });
});
