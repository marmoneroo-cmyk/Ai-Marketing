import { and, eq } from 'drizzle-orm';
import { createConnector, decryptToken } from '@brandpilot/connectors';
import { socialAccounts, connectorTokens, kpiDaily } from '@brandpilot/db';
import { logger } from '@brandpilot/observability';
import type { WorkerContext } from './context';

/** `YYYY-MM-DD` (UTC) for drizzle `date` columns. */
function todayUtcString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Refresh account-level audience stats (follower counts) for every CONNECTED
 * social account of an org, from providers whose connector exposes
 * `fetchAudience`. Two write targets, both idempotent:
 *
 *   - `social_accounts.metadata` — the current per-account snapshot the
 *     connections/dashboard read-models surface ("@handle · N followers").
 *   - `kpi_daily.followers` — today's org-day row (upsert), so the dashboard
 *     KPI + analytics series can show follower count and its trend.
 *
 * Best-effort and fully isolated per account: one account's failure (revoked
 * token, personal account with no follower field, provider hiccup) is logged
 * and skipped, never aborting the others or the caller. Returns how many
 * accounts were successfully refreshed.
 */
export async function refreshFollowerMetrics(ctx: WorkerContext, orgId: string): Promise<number> {
  const accounts = await ctx.db
    .select({
      id: socialAccounts.id,
      provider: socialAccounts.provider,
      externalId: socialAccounts.externalId,
      metadata: socialAccounts.metadata,
    })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.orgId, orgId), eq(socialAccounts.status, 'connected')));

  logger.info({ orgId, connectedAccounts: accounts.length }, 'refreshing follower metrics');

  let refreshed = 0;
  let latestFollowers: number | undefined;

  for (const account of accounts) {
    try {
      const connector = createConnector(account.provider);
      if (typeof connector.fetchAudience !== 'function') {
        logger.info({ orgId, provider: account.provider }, 'provider has no audience API; skipping');
        continue; // provider has no audience API
      }

      const [tok] = await ctx.db
        .select()
        .from(connectorTokens)
        .where(eq(connectorTokens.socialAccountId, account.id))
        .limit(1);
      if (!tok) {
        logger.warn({ orgId, accountId: account.id }, 'no stored token for account; skipping followers');
        continue; // no stored token → nothing to authenticate with
      }

      const accessToken = decryptToken(tok.accessTokenEnc);
      const stats = await connector.fetchAudience({ accountId: account.externalId, accessToken });
      logger.info(
        { orgId, provider: account.provider, followers: stats.followers ?? null },
        'fetched audience stats',
      );
      if (stats.followers === undefined) continue; // e.g. personal account: no follower field

      const existing = (account.metadata ?? {}) as Record<string, unknown>;
      await ctx.db
        .update(socialAccounts)
        .set({
          metadata: {
            ...existing,
            followers: stats.followers,
            ...(stats.follows !== undefined ? { follows: stats.follows } : {}),
            ...(stats.mediaCount !== undefined ? { mediaCount: stats.mediaCount } : {}),
            followersUpdatedAt: new Date().toISOString(),
          },
        })
        .where(and(eq(socialAccounts.id, account.id), eq(socialAccounts.orgId, orgId)));

      refreshed += 1;
      latestFollowers = stats.followers;
    } catch (err: unknown) {
      logger.warn({ err, orgId, accountId: account.id }, 'follower metrics refresh failed for account');
    }
  }

  // Roll the freshest follower count into today's org-day KPI row so the
  // dashboard/analytics can read it without clobbering the rollup's other columns.
  if (latestFollowers !== undefined) {
    const day = todayUtcString();
    await ctx.db
      .insert(kpiDaily)
      .values({ orgId, day, followers: latestFollowers })
      .onConflictDoUpdate({
        target: [kpiDaily.orgId, kpiDaily.day],
        set: { followers: latestFollowers },
      });
  }

  if (refreshed > 0) {
    logger.info({ orgId, refreshed, followers: latestFollowers }, 'follower metrics refreshed');
  }
  return refreshed;
}
