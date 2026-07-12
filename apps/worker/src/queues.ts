import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { logger, captureError } from '@brandpilot/observability';
import {
  QUEUES,
  type AutomationSignalJobData,
  type PublishJobData,
  type ReindexJobData,
  type AnalyticsJobData,
  type ContentPlanJobData,
  type CommentsPollJobData,
} from '@brandpilot/core';

/**
 * BullMQ producers for the queues the worker itself publishes to. Consumers
 * (the queue processors) live in `workers/*`; these are the write side — the
 * signal bridge, the scheduler, and any in-worker fan-out enqueue through here.
 *
 * All producers share the single ioredis connection created in `redis.ts`, so
 * shutdown only has to close these queues plus that one connection.
 */
export interface Producers {
  automationSignal: Queue<AutomationSignalJobData>;
  publish: Queue<PublishJobData>;
  brainReindex: Queue<ReindexJobData>;
  analyticsRollup: Queue<AnalyticsJobData>;
  contentPlan: Queue<ContentPlanJobData>;
  commentsPoll: Queue<CommentsPollJobData>;
}

/** Build the producer set on the shared connection. */
export function createProducers(connection: IORedis): Producers {
  const producers: Producers = {
    automationSignal: new Queue<AutomationSignalJobData>(QUEUES.automationSignal, { connection }),
    publish: new Queue<PublishJobData>(QUEUES.publish, { connection }),
    brainReindex: new Queue<ReindexJobData>(QUEUES.brainReindex, { connection }),
    analyticsRollup: new Queue<AnalyticsJobData>(QUEUES.analyticsRollup, { connection }),
    contentPlan: new Queue<ContentPlanJobData>(QUEUES.contentPlan, { connection }),
    commentsPoll: new Queue<CommentsPollJobData>(QUEUES.commentsPoll, { connection }),
  };

  // BullMQ re-emits Redis connection errors as the Queue's own 'error' event;
  // with no listener attached, Node treats it as unhandled and crashes the
  // whole process (all workers + scheduler with it). One listener per producer
  // turns a Redis blip into a log line + Sentry event instead.
  for (const [name, queue] of Object.entries(producers)) {
    queue.on('error', (err: Error) => {
      logger.error({ err, producer: name }, 'producer queue error');
      captureError(err, { producer: name });
    });
  }

  return producers;
}

/** Close every producer queue (used on graceful shutdown). */
export async function closeProducers(producers: Producers): Promise<void> {
  await Promise.all(Object.values(producers).map((q) => q.close()));
}
