import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { QUEUES, type ContentPlanJobData } from '@brandpilot/core';
import { logger } from '@brandpilot/observability';
import type { WorkerContext } from '../context';

/**
 * Generates a week's worth of content on demand: runs the Content Engine's
 * weekly planner AND per-platform variant fan-out as a durable background job,
 * enqueued by `POST /content/plan`. The plan + fan-out logic lives in
 * `ContentEngine.generateWeeklyPlanWithVariants` so this on-demand path and the
 * scheduled `content.weekly_plan` automation produce identical output (plan +
 * approvable, brand-voice-scored variants). Everything is org-scoped by `orgId`.
 */
export function createContentWorker(ctx: WorkerContext, connection: IORedis): Worker<ContentPlanJobData> {
  return new Worker<ContentPlanJobData>(
    QUEUES.contentPlan,
    async (job: Job<ContentPlanJobData>) => {
      const { orgId, weekStartIso, formats } = job.data;
      const weekStart = weekStartIso ? new Date(weekStartIso) : new Date();

      const result = await ctx.content.generateWeeklyPlanWithVariants(orgId, weekStart, {
        ...(formats ? { formats } : {}),
      });
      if (result.variantErrors > 0) {
        logger.warn(
          {
            orgId,
            planId: result.planId,
            variantErrors: result.variantErrors,
            // Surface the real cause — this was previously invisible, so a plan
            // that drafted zero usable variants looked identical to a healthy run.
            variantErrorSample: result.variantErrorSample,
          },
          'some content variants failed to draft',
        );
      }
      return { planId: result.planId, items: result.itemCount, variants: result.variantCount };
    },
    { connection, concurrency: 3 },
  );
}
