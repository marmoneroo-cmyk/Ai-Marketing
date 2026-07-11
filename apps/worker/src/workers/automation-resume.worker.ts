import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { QUEUES, type AutomationResumeJobData } from '@brandpilot/core';
import type { WorkerContext } from '../context';

/**
 * Resume a paused automation run after a human approval decision. The API
 * enqueues one of these when an approval is granted or rejected; the engine
 * continues (or cancels) the halted run from its approval gate.
 */
export function createAutomationResumeWorker(
  ctx: WorkerContext,
  connection: IORedis,
): Worker<AutomationResumeJobData> {
  return new Worker<AutomationResumeJobData>(
    QUEUES.automationResume,
    async (job: Job<AutomationResumeJobData>) => {
      const { orgId, runId, approved } = job.data;
      return ctx.automation.resumeRun(orgId, runId, approved);
    },
    { connection, concurrency: 2 },
  );
}
