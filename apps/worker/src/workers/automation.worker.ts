import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { QUEUES, type AutomationSignalJobData } from '@brandpilot/core';
import type { WorkerContext } from '../context';

/** The loop conductor: fire matching workflows whenever a signal arrives. */
export function createAutomationWorker(ctx: WorkerContext, connection: IORedis): Worker<AutomationSignalJobData> {
  return new Worker<AutomationSignalJobData>(
    QUEUES.automationSignal,
    async (job: Job<AutomationSignalJobData>) => ctx.automation.handleSignal(job.data.orgId, job.data.signal),
    { connection, concurrency: 4 },
  );
}
