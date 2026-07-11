import type { Worker } from 'bullmq';
import { initTelemetry, initErrorTracking, captureError, logger } from '@brandpilot/observability';
import { buildContext } from './context';
import { closeProducers } from './queues';
import { startScheduler } from './scheduler';
import { createDiscoveryWorker } from './workers/discovery.worker';
import { createReindexWorker, createAnalyticsWorker } from './workers/ops.worker';
import { createAutomationWorker } from './workers/automation.worker';
import { createPublishWorker } from './workers/publish.worker';
import { createConversationWorker } from './workers/conversation.worker';
import { createAutomationResumeWorker } from './workers/automation-resume.worker';
import { createContentWorker } from './workers/content.worker';

/** Grace window for a worker's in-flight job(s) to finish before force-closing. */
const WORKER_CLOSE_GRACE_MS = 10_000;
/** Delay before exiting on an uncaught exception, to give pino + Sentry a tick to flush. */
const UNCAUGHT_EXCEPTION_EXIT_DELAY_MS = 250;

/**
 * Close a BullMQ worker bounded by a grace window: if the graceful close
 * (drains in-flight jobs) hasn't settled within `graceMs`, log a warning,
 * fire a best-effort forced close, and STOP AWAITING — so one stuck in-flight
 * job can never block the whole process past SIGTERM's grace window.
 */
async function closeWorkerWithGrace(w: Worker, graceMs: number): Promise<void> {
  let settled = false;
  const graceful = w.close().then(() => {
    settled = true;
  });
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, graceMs));

  await Promise.race([graceful, timeout]);
  if (settled) return;

  logger.warn({ worker: w.name, graceMs }, 'worker close exceeded grace window; forcing close');
  // Not awaited: BullMQ only honors `force` on the FIRST close() call for a
  // given worker, so this is a best-effort nudge, not a guarantee — what
  // actually bounds shutdown is that we stop awaiting here, at the timeout.
  void w.close(true).catch((err: unknown) => {
    logger.error({ err, worker: w.name }, 'forced worker close failed');
    captureError(err, { worker: w.name });
  });
}

/** Worker entrypoint: boots the shared context and starts every queue processor. */
async function main(): Promise<void> {
  // Start tracing first so downstream instrumentation (Redis, HTTP, etc.) is
  // active before the context and workers spin up.
  initTelemetry('brandpilot-worker');
  initErrorTracking('brandpilot-worker');

  // Process-level safety net: an unhandled 'error' event, a rejected promise
  // with no .catch, or a thrown exception outside any try/catch would
  // otherwise crash the process with nothing reaching Sentry. Registered once,
  // here, so it covers the whole process lifetime (not just job processing).
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection');
    captureError(reason, { kind: 'unhandledRejection' });
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaught exception');
    captureError(err, { kind: 'uncaughtException' });
    // The process is in an unknown state after an uncaught exception — do not
    // keep running. Exit on a short delay (not synchronously) so the log line
    // and Sentry's fire-and-forget request get a tick to flush first.
    setTimeout(() => process.exit(1), UNCAUGHT_EXCEPTION_EXIT_DELAY_MS);
  });

  const ctx = buildContext();
  const { connection, producers } = ctx;

  const workers: Worker[] = [
    createDiscoveryWorker(ctx, connection),
    createReindexWorker(ctx, connection),
    createAnalyticsWorker(ctx, connection),
    createAutomationWorker(ctx, connection),
    createPublishWorker(ctx, connection),
    createConversationWorker(ctx, connection),
    createAutomationResumeWorker(ctx, connection),
    createContentWorker(ctx, connection),
  ];

  for (const w of workers) {
    w.on('completed', (job) => logger.info({ worker: w.name, jobId: job.id }, 'job completed'));
    w.on('failed', (job, err) => {
      const jobId = job?.id;
      logger.error({ worker: w.name, jobId, err }, 'job failed');
      captureError(err, { worker: w.name, jobId });
    });
    // BullMQ re-emits Redis connection errors as the Worker's own 'error'
    // event; with no listener attached, Node treats it as unhandled and
    // crashes the whole process — killing every OTHER worker + the scheduler
    // along with it, none of which reach Sentry on the way down.
    w.on('error', (err) => {
      logger.error({ worker: w.name, err }, 'worker error');
      captureError(err, { worker: w.name });
    });
  }

  // The autonomous clock: repeatable ticks that produce reindex/rollup/publish
  // jobs and run due schedule workflows.
  const scheduler = await startScheduler(ctx);

  logger.info({ processors: workers.length }, 'BrandPilot worker started');

  const shutdown = async (): Promise<void> => {
    logger.info('shutting down workers');
    try {
      await Promise.all([
        ...workers.map((w) => closeWorkerWithGrace(w, WORKER_CLOSE_GRACE_MS)),
        closeWorkerWithGrace(scheduler.worker, WORKER_CLOSE_GRACE_MS),
      ]);
      await scheduler.queue.close();
      await closeProducers(producers);
      await connection.quit();
    } catch (err: unknown) {
      // A hang here is already bounded by closeWorkerWithGrace's own timeout;
      // this only guards against a REJECTION (e.g. a Redis error on close)
      // silently preventing the process from ever reaching exit.
      logger.error({ err }, 'error during shutdown');
      captureError(err, { kind: 'shutdown' });
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Worker bootstrap failed');
  process.exit(1);
});
