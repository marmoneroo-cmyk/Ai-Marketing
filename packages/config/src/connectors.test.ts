import { describe, expect, it } from 'vitest';
import { connectorRouteUrl } from './connectors';

/**
 * `connectorRouteUrl` is the single source of truth for every URL we hand to an
 * external provider (OAuth redirect_uri + webhook callback_url). It MUST target
 * the API origin (`API_URL`) at the root — never the web app, never a `/api`
 * prefix — because the API mounts routes at the root and providers deliver
 * straight to that origin.
 */
describe('connectorRouteUrl', () => {
  const env = { API_URL: 'http://localhost:4000' };

  it('builds a callback URL on the API origin at the root (no /api prefix)', () => {
    expect(connectorRouteUrl(env, 'meta/callback')).toBe(
      'http://localhost:4000/connectors/meta/callback',
    );
  });

  it('builds a webhook URL on the API origin', () => {
    expect(connectorRouteUrl(env, 'whatsapp/webhook')).toBe(
      'http://localhost:4000/connectors/whatsapp/webhook',
    );
  });

  it('never points at the web app or a /api prefix', () => {
    const url = connectorRouteUrl({ API_URL: 'https://app.example.com:3000' }, 'meta/callback');
    // API_URL is the API origin; even if it shares a host with the web, the path
    // stays `/connectors/...` with no `/api` segment.
    expect(url).toBe('https://app.example.com:3000/connectors/meta/callback');
    expect(url).not.toContain('/api/connectors');
  });

  it('is stable across authorize + token-exchange callers (byte-identical)', () => {
    // Providers reject a token exchange whose redirect_uri differs from the
    // authorize step; identical inputs must yield identical output.
    const a = connectorRouteUrl(env, 'meta/callback');
    const b = connectorRouteUrl(env, 'meta/callback');
    expect(a).toBe(b);
  });

  it('tolerates a trailing slash on API_URL and a leading slash on the path', () => {
    expect(connectorRouteUrl({ API_URL: 'http://localhost:4000/' }, '/tiktok/callback')).toBe(
      'http://localhost:4000/connectors/tiktok/callback',
    );
  });
});
