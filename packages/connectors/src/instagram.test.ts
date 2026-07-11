import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resetEnvCache } from '@brandpilot/config';
import { InstagramLoginConnector } from './instagram';

/** Seed the env vars loadEnv() requires, mirroring the other connector specs. */
function seedEnv(): void {
  process.env.DATABASE_URL = 'postgres://localhost/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.AUTH_SECRET = 'x'.repeat(16);
  process.env.TOKEN_ENCRYPTION_KEY = 'test-key';
  process.env.ANTHROPIC_API_KEY = 'test';
  process.env.VOYAGE_API_KEY = 'test';
  process.env.API_URL = 'https://api.test.example';
  process.env.INSTAGRAM_APP_ID = 'ig-app-id';
  process.env.INSTAGRAM_APP_SECRET = 'ig-app-secret';
  resetEnvCache();
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const originalFetch = global.fetch;
beforeEach(() => seedEnv());
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('InstagramLoginConnector.connect', () => {
  it('exchanges code → short → long-lived token and identifies the account', async () => {
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.startsWith('https://api.instagram.com/oauth/access_token')) {
        return jsonResponse({
          access_token: 'short-tok',
          user_id: 178414,
          permissions: 'instagram_business_basic,instagram_business_content_publish',
        });
      }
      if (u.includes('graph.instagram.com/access_token')) {
        return jsonResponse({ access_token: 'long-tok', token_type: 'bearer', expires_in: 5_184_000 });
      }
      if (u.includes('graph.instagram.com/me')) {
        return jsonResponse({ user_id: '178414', username: 'marmoneroo' });
      }
      throw new Error(`unexpected url ${u}`);
    }) as unknown as typeof fetch;

    const { tokens, account } = await new InstagramLoginConnector().connect('the-code');

    expect(tokens.accessToken).toBe('long-tok');
    expect(tokens.expiresAt).toBeInstanceOf(Date);
    expect(tokens.scopes).toEqual(['instagram_business_basic', 'instagram_business_content_publish']);
    expect(account.externalId).toBe('178414');
    expect(account.handle).toBe('marmoneroo');

    // First hop is the code exchange to api.instagram.com, POSTing the code +
    // the byte-exact redirect_uri (…/connectors/instagram/callback).
    expect(calls[0]?.url).toBe('https://api.instagram.com/oauth/access_token');
    expect(String(calls[0]?.init?.body)).toContain('code=the-code');
    expect(String(calls[0]?.init?.body)).toContain('instagram%2Fcallback');
  });

  it('throws a generic error when the code exchange fails', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse({ error_type: 'OAuthException', error_message: 'bad code' }, false, 400),
    ) as unknown as typeof fetch;
    await expect(new InstagramLoginConnector().connect('bad')).rejects.toThrow(
      /Instagram token exchange failed/,
    );
  });
});

describe('InstagramLoginConnector.push', () => {
  it('publishes via the two-step container + media_publish', async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith('/media')) return jsonResponse({ id: 'container-1' });
      if (u.endsWith('/media_publish')) return jsonResponse({ id: 'media-1' });
      throw new Error(`unexpected url ${u}`);
    }) as unknown as typeof fetch;

    const res = await new InstagramLoginConnector().push({
      kind: 'publish',
      accountId: '178414',
      accessToken: 'long-tok',
      payload: { imageUrl: 'https://cdn.example/x.jpg', caption: 'hi' },
    });

    expect(res.externalId).toBe('media-1');
    expect(calls.some((u) => u.includes('/178414/media'))).toBe(true);
    expect(calls.some((u) => u.includes('/178414/media_publish'))).toBe(true);
  });

  it('rejects a publish without an image', async () => {
    await expect(
      new InstagramLoginConnector().push({
        kind: 'publish',
        accountId: '1',
        accessToken: 't',
        payload: { caption: 'x' },
      }),
    ).rejects.toThrow(/requires an imageUrl/);
  });
});
