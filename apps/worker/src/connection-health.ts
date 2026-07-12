import { and, eq } from 'drizzle-orm';
import { createConnector, decryptToken, encryptToken } from '@brandpilot/connectors';
import { socialAccounts, connectorTokens } from '@brandpilot/db';
import { logger } from '@brandpilot/observability';
import type { WorkerContext } from './context';

/**
 * Refresh a connector token this far ahead of its expiry. Provider tokens have
 * very different lifetimes (IG long-lived ~60d, TikTok access ~24h), so a 7-day
 * lead time refreshes IG well before expiry while a daily run still catches
 * short-lived tokens the day they'd lapse.
 */
const REFRESH_LEAD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Keep an org's connected accounts alive. For every connected account whose
 * token is near (or past) expiry, re-issue it via the provider's `refreshAuth`
 * and store the fresh token. If the refresh FAILS, the connection is
 * effectively dead — mark the account `expired` so the Settings channel row
 * flips to "needs attention" and the owner is prompted to reconnect, instead of
 * publish/pull calls failing opaquely forever.
 *
 * Idempotent + best-effort per account: a fresh token is skipped (no wasted
 * call), and one account's failure never aborts the others. Returns counts.
 */
export async function refreshExpiringTokens(
  ctx: WorkerContext,
  orgId: string,
): Promise<{ refreshed: number; expired: number }> {
  const accounts = await ctx.db
    .select({ id: socialAccounts.id, provider: socialAccounts.provider })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.orgId, orgId), eq(socialAccounts.status, 'connected')));

  let refreshed = 0;
  let expired = 0;

  for (const account of accounts) {
    const [tok] = await ctx.db
      .select()
      .from(connectorTokens)
      .where(eq(connectorTokens.socialAccountId, account.id))
      .limit(1);
    // No token, or a non-expiring token → nothing to refresh.
    if (!tok || !tok.expiresAt) continue;
    if (tok.expiresAt.getTime() - Date.now() > REFRESH_LEAD_MS) continue; // still fresh

    const connector = createConnector(account.provider);
    // TikTok rotates a dedicated refresh token; IG/Meta re-exchange the current
    // (long-lived) access token. Pass whichever the account stored.
    const secret = tok.refreshTokenEnc
      ? decryptToken(tok.refreshTokenEnc)
      : decryptToken(tok.accessTokenEnc);

    try {
      const next = await connector.refreshAuth(secret);
      await ctx.db
        .update(connectorTokens)
        .set({
          accessTokenEnc: encryptToken(next.accessToken),
          ...(next.refreshToken ? { refreshTokenEnc: encryptToken(next.refreshToken) } : {}),
          ...(next.expiresAt ? { expiresAt: next.expiresAt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(connectorTokens.socialAccountId, account.id));
      refreshed++;
      logger.info({ orgId, provider: account.provider }, 'refreshed connector token');
    } catch (err: unknown) {
      await ctx.db
        .update(socialAccounts)
        .set({ status: 'expired' })
        .where(and(eq(socialAccounts.id, account.id), eq(socialAccounts.orgId, orgId)));
      expired++;
      logger.warn(
        { err, orgId, provider: account.provider },
        'token refresh failed; marked account expired (reconnect required)',
      );
    }
  }

  if (refreshed > 0 || expired > 0) {
    logger.info({ orgId, refreshed, expired }, 'connection health checked');
  }
  return { refreshed, expired };
}
