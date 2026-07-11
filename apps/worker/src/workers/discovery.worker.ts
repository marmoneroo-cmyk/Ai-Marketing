import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { eq } from 'drizzle-orm';
import { QUEUES, type DiscoveryJobData } from '@brandpilot/core';
import { createConnector } from '@brandpilot/connectors';
import { contentPlans } from '@brandpilot/db';
import type { DiscoverySources } from '@brandpilot/discovery';
import { logger } from '@brandpilot/observability';
import type { WorkerContext } from '../context';

/**
 * First-run bootstrap: once the Business DNA exists, generate the org's first
 * content plan immediately instead of leaving the dashboard empty until the
 * weekly `content.weekly_plan` automation next fires (its cron is Mondays
 * 08:00 UTC — up to a week away). Runs at most once per org: guarded on the
 * org having zero content plans, so a re-run of discovery never duplicates it.
 * Best-effort — a failed bootstrap must never fail the discovery job itself.
 */
async function bootstrapFirstContentPlan(ctx: WorkerContext, orgId: string): Promise<void> {
  const existing = await ctx.db
    .select({ id: contentPlans.id })
    .from(contentPlans)
    .where(and(eq(contentPlans.orgId, orgId)))
    .limit(1);
  if (existing.length > 0) return;

  await ctx.producers.contentPlan.add('plan', { orgId });
  logger.info({ orgId }, 'discovery bootstrapped first content plan');
}

/**
 * Runs the Discovery Engine as a durable background job: given a website and/or a
 * connected social account, it ingests the footprint and builds the Business DNA.
 */
export function createDiscoveryWorker(ctx: WorkerContext, connection: IORedis): Worker<DiscoveryJobData> {
  return new Worker<DiscoveryJobData>(
    QUEUES.discovery,
    async (job: Job<DiscoveryJobData>) => {
      const { orgId, websiteUrl, social } = job.data;
      const sources: DiscoverySources = {
        ...(websiteUrl ? { websiteUrl } : {}),
        // Build the PROVIDER-SPECIFIC connector — a TikTok account cannot be pulled
        // via the Meta API. (Same connector-selection fix as the publish worker.)
        ...(social ? { social: { ...social, connector: createConnector(social.provider) } } : {}),
      };
      const result = await ctx.discovery.run(orgId, sources);

      // Org setup: install the default automation workflows so the autonomous
      // loop works out-of-the-box. Idempotent, and best-effort — seeding must
      // never fail the discovery job, so swallow + log any error.
      try {
        await ctx.automation.seedDefaultWorkflows(orgId);
      } catch (err: unknown) {
        logger.warn({ err, orgId }, 'default workflow seeding failed');
      }

      // First-run bootstrap: fill the dashboard with an approvable content plan
      // now, rather than waiting for the weekly cron. Best-effort — a failure
      // here must never fail the discovery job.
      try {
        await bootstrapFirstContentPlan(ctx, orgId);
      } catch (err: unknown) {
        logger.warn({ err, orgId }, 'first content-plan bootstrap failed');
      }

      return result;
    },
    { connection, concurrency: 3 },
  );
}
