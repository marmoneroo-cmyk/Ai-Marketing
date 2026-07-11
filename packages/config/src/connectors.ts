import type { Env } from './env';

/**
 * Absolute URL of an API connector route, built on `API_URL` — the PUBLIC origin
 * of the NestJS API.
 *
 * Why this exists (single source of truth):
 * The API mounts its routes at the ROOT (no global `/api` prefix — see
 * `apps/api/src/main.ts`), so a connector route lives at
 * `${API_URL}/connectors/<path>` (e.g. `http://localhost:4000/connectors/meta/callback`).
 * External providers (Meta, TikTok, WhatsApp) send the user's browser / webhook
 * deliveries straight to that origin, so the OAuth `redirect_uri`, the token
 * exchange's `redirect_uri`, and the webhook `callback_url` must all target the
 * API — never the web app (`APP_URL`), and never a `/api` prefix that does not
 * exist.
 *
 * Providers additionally require the `redirect_uri` sent in the authorize step
 * to be BYTE-IDENTICAL to the one sent in the token exchange. Centralising the
 * construction here guarantees they cannot drift.
 *
 * @param env   Loaded environment (only `API_URL` is read).
 * @param path  Route path under `/connectors/`, e.g. `'meta/callback'` or
 *              `'whatsapp/webhook'`. No leading slash.
 */
export function connectorRouteUrl(env: Pick<Env, 'API_URL'>, path: string): string {
  const base = env.API_URL.replace(/\/+$/, '');
  const suffix = path.replace(/^\/+/, '');
  return `${base}/connectors/${suffix}`;
}
