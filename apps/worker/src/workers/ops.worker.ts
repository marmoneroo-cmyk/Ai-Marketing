import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { QUEUES, type ReindexJobData, type AnalyticsJobData } from '@brandpilot/core';
import { logger } from '@brandpilot/observability';
import type { WorkerContext } from '../context';
import { refreshFollowerMetrics } from '../audience-metrics';

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
      await ctx.brand.computeVoiceProfile(orgId);
      await ctx.brand.analyzePerformance(orgId);
      await ctx.audience.buildPersonasAndSegments(orgId);
      await ctx.brain.indexApprovedKnowledge(orgId);
      return { ok: true };
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
