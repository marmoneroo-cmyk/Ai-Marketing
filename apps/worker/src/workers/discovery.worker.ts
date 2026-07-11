import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { QUEUES, type DiscoveryJobData } from '@brandpilot/core';
import { createConnector } from '@brandpilot/connectors';
import type { DiscoverySources } from '@brandpilot/discovery';
import { logger } from '@brandpilot/observability';
import type { WorkerContext } from '../context';

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

      return result;
    },
    { connection, concurrency: 3 },
  );
}
