import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import { resetEnvCache } from '@brandpilot/config';
import type { AuthService, GoogleAuthOutcome, GoogleLoginInput } from './auth.service';
import { createNonceState } from '../common/oauth-state';

// Mock the structured logger so the callback's 'Google OAuth callback failed'
// warning is observable without emitting real log lines.
const { logger } = vi.hoisted(() => ({ logger: { warn: vi.fn() } }));
vi.mock('@brandpilot/observability', () => ({ logger }));

import { GoogleOAuthController } from './google-oauth.controller';

const TEST_APP_URL = 'https://app.test.brandpilot.example';
const TEST_API_URL = 'https://api.test.brandpilot.example';
const AUTH_SECRET = 'x'.repeat(16);

/**
 * Seed the env vars `loadEnv()` requires, mirroring the idiom used by
 * `password-reset.service.spec.ts` / `org-invite.service.spec.ts`: mutate
 * `process.env` then reset the memoized env cache. `googleConfigured` toggles
 * whether GOOGLE_CLIENT_ID/SECRET are present, to drive the "not configured"
 * branch.
 */
function seedTestEnv(googleConfigured: boolean): void {
  process.env.DATABASE_URL = 'postgres://localhost/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.AUTH_SECRET = AUTH_SECRET;
  process.env.TOKEN_ENCRYPTION_KEY = 'test-key';
  process.env.ANTHROPIC_API_KEY = 'test';
  process.env.VOYAGE_API_KEY = 'test';
  process.env.APP_URL = TEST_APP_URL;
  process.env.API_URL = TEST_API_URL;
  if (googleConfigured) {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  } else {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  }
  resetEnvCache();
}

/** Fake Express Response that just records every `redirect(url)` call. */
function fakeResponse(): { res: Response; redirectedTo: string[] } {
  const redirectedTo: string[] = [];
  const res = { redirect: (url: string) => redirectedTo.push(url) } as unknown as Response;
  return { res, redirectedTo };
}

/** Fake AuthService recording every `loginOrRegisterViaGoogle` call. */
function fakeAuthService(result: GoogleAuthOutcome): {
  service: AuthService;
  calls: GoogleLoginInput[];
} {
  const calls: GoogleLoginInput[] = [];
  const service = {
    loginOrRegisterViaGoogle: async (input: GoogleLoginInput) => {
      calls.push(input);
      return result;
    },
  } as unknown as AuthService;
  return { service, calls };
}

/** Stub global `fetch` to answer Google's token + userinfo endpoints. */
function stubGoogleFetch(options: {
  tokenOk?: boolean;
  accessToken?: string;
  profileOk?: boolean;
  profile?: Record<string, unknown>;
}): ReturnType<typeof vi.fn> {
  const {
    tokenOk = true,
    accessToken = 'ga-token-123',
    profileOk = true,
    profile = { sub: 'g-1', email: 'ava@biz.co', email_verified: true, name: 'Ava Chen' },
  } = options;

  const f = vi.fn(async (url: string) => {
    if (url.includes('oauth2.googleapis.com/token')) {
      return {
        ok: tokenOk,
        status: tokenOk ? 200 : 400,
        headers: { get: () => null },
        json: async () => (tokenOk ? { access_token: accessToken } : {}),
      };
    }
    if (url.includes('googleapis.com/oauth2/v3/userinfo')) {
      return {
        ok: profileOk,
        status: profileOk ? 200 : 400,
        headers: { get: () => null },
        json: async () => (profileOk ? profile : {}),
      };
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  vi.stubGlobal('fetch', f);
  return f;
}

describe('GoogleOAuthController', () => {
  beforeEach(() => {
    logger.warn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetEnvCache();
  });

  describe('GET /auth/google', () => {
    it('redirects to login with oauth_error=google_unavailable when not configured', async () => {
      seedTestEnv(false);
      const { service } = fakeAuthService({ accessToken: 'unused' });
      const controller = new GoogleOAuthController(service);
      const { res, redirectedTo } = fakeResponse();

      await controller.googleStart(res);

      expect(redirectedTo).toEqual([`${TEST_APP_URL}/login?oauth_error=google_unavailable`]);
    });

    it('redirects to the Google consent screen with a signed state when configured', async () => {
      seedTestEnv(true);
      const { service } = fakeAuthService({ accessToken: 'unused' });
      const controller = new GoogleOAuthController(service);
      const { res, redirectedTo } = fakeResponse();

      await controller.googleStart(res);

      expect(redirectedTo).toHaveLength(1);
      const url = new URL(redirectedTo[0] ?? '');
      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe('test-client-id');
      expect(url.searchParams.get('redirect_uri')).toBe(`${TEST_API_URL}/auth/google/callback`);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe('openid email profile');
      expect(url.searchParams.get('prompt')).toBe('select_account');
      expect(url.searchParams.get('state')).toBeTruthy();
    });
  });

  describe('GET /auth/google/callback — bad state never reaches the token exchange', () => {
    it('rejects a missing state, redirects oauth_error=google_failed, and never calls fetch', async () => {
      seedTestEnv(true);
      const fetchSpy = stubGoogleFetch({});
      const { service, calls } = fakeAuthService({ accessToken: 'unused' });
      const controller = new GoogleOAuthController(service);
      const { res, redirectedTo } = fakeResponse();

      await controller.googleCallback(res, 'some-code', undefined, undefined);

      expect(redirectedTo).toEqual([`${TEST_APP_URL}/login?oauth_error=google_failed`]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
    });

    it('rejects a tampered state, redirects oauth_error=google_failed, and never calls fetch', async () => {
      seedTestEnv(true);
      const fetchSpy = stubGoogleFetch({});
      const { service, calls } = fakeAuthService({ accessToken: 'unused' });
      const controller = new GoogleOAuthController(service);
      const { res, redirectedTo } = fakeResponse();

      const validState = createNonceState(AUTH_SECRET);
      const tamperedState = `${validState}tampered`;

      await controller.googleCallback(res, 'some-code', tamperedState, undefined);

      expect(redirectedTo).toEqual([`${TEST_APP_URL}/login?oauth_error=google_failed`]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
    });

    it('rejects a state signed under a different secret, and never calls fetch', async () => {
      seedTestEnv(true);
      const fetchSpy = stubGoogleFetch({});
      const { service, calls } = fakeAuthService({ accessToken: 'unused' });
      const controller = new GoogleOAuthController(service);
      const { res, redirectedTo } = fakeResponse();

      const foreignState = createNonceState('a-totally-different-secret');

      await controller.googleCallback(res, 'some-code', foreignState, undefined);

      expect(redirectedTo).toEqual([`${TEST_APP_URL}/login?oauth_error=google_failed`]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /auth/google/callback — happy path + outcomes', () => {
    it('exchanges the code, fetches the profile, and redirects with the token in the URL FRAGMENT (not a query param)', async () => {
      seedTestEnv(true);
      stubGoogleFetch({
        accessToken: 'ga-token-123',
        profile: { sub: 'g-1', email: 'Ava@Biz.CO', email_verified: true, name: 'Ava Chen' },
      });
      const { service, calls } = fakeAuthService({ accessToken: 'signed.jwt.token' });
      const controller = new GoogleOAuthController(service);
      const { res, redirectedTo } = fakeResponse();

      const state = createNonceState(AUTH_SECRET);
      await controller.googleCallback(res, 'auth-code-abc', state, undefined);

      // Profile is passed through as-is (AuthService normalizes/lowercases the email).
      expect(calls).toEqual([{ email: 'Ava@Biz.CO', emailVerified: true, name: 'Ava Chen' }]);

      expect(redirectedTo).toEqual([`${TEST_APP_URL}/auth/callback#token=signed.jwt.token`]);
      // Never a query param anywhere in the redirect target.
      expect(redirectedTo[0]).not.toContain('?token=');
      expect(redirectedTo[0]).not.toContain('&token=');
    });

    it('redirects oauth_error=email_registered when AuthService refuses to auto-link', async () => {
      seedTestEnv(true);
      stubGoogleFetch({});
      const { service, calls } = fakeAuthService({ error: 'email_registered' });
      const controller = new GoogleOAuthController(service);
      const { res, redirectedTo } = fakeResponse();

      const state = createNonceState(AUTH_SECRET);
      await controller.googleCallback(res, 'auth-code-abc', state, undefined);

      expect(calls).toHaveLength(1);
      expect(redirectedTo).toEqual([`${TEST_APP_URL}/login?oauth_error=email_registered`]);
    });

    it('treats a provider error (consent denied) as a failure without calling fetch', async () => {
      seedTestEnv(true);
      const fetchSpy = stubGoogleFetch({});
      const { service, calls } = fakeAuthService({ accessToken: 'unused' });
      const controller = new GoogleOAuthController(service);
      const { res, redirectedTo } = fakeResponse();

      const state = createNonceState(AUTH_SECRET);
      await controller.googleCallback(res, undefined, state, 'access_denied');

      expect(redirectedTo).toEqual([`${TEST_APP_URL}/login?oauth_error=google_failed`]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
    });

    it('redirects oauth_error=google_failed and never calls AuthService when the token exchange fails', async () => {
      seedTestEnv(true);
      stubGoogleFetch({ tokenOk: false });
      const { service, calls } = fakeAuthService({ accessToken: 'unused' });
      const controller = new GoogleOAuthController(service);
      const { res, redirectedTo } = fakeResponse();

      const state = createNonceState(AUTH_SECRET);
      await controller.googleCallback(res, 'auth-code-abc', state, undefined);

      expect(redirectedTo).toEqual([`${TEST_APP_URL}/login?oauth_error=google_failed`]);
      expect(calls).toHaveLength(0);
    });

    it('never leaks error details into the redirect target', async () => {
      seedTestEnv(true);
      stubGoogleFetch({ profileOk: false });
      const { service } = fakeAuthService({ accessToken: 'unused' });
      const controller = new GoogleOAuthController(service);
      const { res, redirectedTo } = fakeResponse();

      const state = createNonceState(AUTH_SECRET);
      await controller.googleCallback(res, 'auth-code-abc', state, undefined);

      expect(redirectedTo[0]).toBe(`${TEST_APP_URL}/login?oauth_error=google_failed`);
    });
  });
});
