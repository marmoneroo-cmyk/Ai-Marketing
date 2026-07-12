import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { QUEUES, type ReindexJobData, type AnalyticsJobData } from '@brandpilot/core';
import { logger } from '@brandpilot/observability';
import type { WorkerContext } from '../context';
import { refreshFollowerMetrics } from '../audience-metrics';
import { refreshExpiringTokens } from '../connection-health';

/**
 * Continuous learning: recompute derived intelligence (voice, patterns, audience)
 * AND index the owner's approved FAQs/policies/objection-rebuttals into the
 * semantic pool so customer-facing replies ground on their curated answers.
 */
export function createReindexWorker(ctx: WorkerContext, connection: IORedis): Worker<ReindexJobData> {
  return new Worker<ReindexJobData>(
    QUEUES.brainReindex,
    async (job: Job<ReindexJobData>) => {
      const { orgId } = job.data;
      // Per-step isolation: one failing step (e.g. a persona LLM call) must not
      // skip the others, which would silently leave a customer's voice profile,
      // performance patterns, or approved-knowledge index stale with no clue
      // which step broke. Each runs independently and logs its own failure.
      const steps: Array<readonly [string, () => Promise<unknown>]> = [
        ['brand.voice', () => ctx.brand.computeVoiceProfile(orgId)],
        ['brand.performance', () => ctx.brand.analyzePerformance(orgId)],
        ['audience.segments', () => ctx.audience.buildPersonasAndSegments(orgId)],
        ['brain.knowledge', () => ctx.brain.indexApprovedKnowledge(orgId)],
        // Keep connector tokens alive (refresh before expiry, mark expired on
        // failure) so a customer's channels never silently die.
        ['connection.health', () => refreshExpiringTokens(ctx, orgId)],
      ];
      let failed = 0;
      for (const [step, run] of steps) {
        try {
          await run();
        } catch (err: unknown) {
          failed++;
          logger.warn({ err, orgId, step }, 'reindex step failed');
        }
      }
      return { ok: failed === 0, steps: steps.length, failed };
    },
    { connection, concurrency: 2 },
  );
}

/** Continuous improvement: daily KPI rollup + optimization recommendations. */
export function createAnalyticsWorker(ctx: WorkerContext, connection: IORedis): Worker<AnalyticsJobData> {
  return new Worker<AnalyticsJobData>(
    QUEUES.analyticsRollup,
    async (job: Job<AnalyticsJobData>) => {
      const { orgId } = job.data;
      await ctx.analytics.rollupDaily(orgId, new Date());
      // Keep follower counts fresh daily. Best-effort — must never fail the
      // rollup (rollupDaily's upsert leaves `followers` untouched, so this write
      // is preserved).
      try {
        await refreshFollowerMetrics(ctx, orgId);
      } catch (err: unknown) {
        logger.warn({ err, orgId }, 'daily follower metrics refresh failed');
      }
      await ctx.optimization.analyze(orgId);
      return { ok: true };
    },
    { connection, concurrency: 2 },
  );
}
