import type { Provider } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUES } from '@brandpilot/core';
import { loadEnv } from '@brandpilot/config';

/** Injection token for the Discovery job queue. */
export const DISCOVERY_QUEUE = Symbol('DISCOVERY_QUEUE');

/** Injection token for the inbound-conversation job queue (webhook producer). */
export const CONVERSATION_INBOUND_QUEUE = Symbol('CONVERSATION_INBOUND_QUEUE');

/** Injection token for the automation-resume job queue (approvals producer). */
export const AUTOMATION_RESUME_QUEUE = Symbol('AUTOMATION_RESUME_QUEUE');

/** Injection token for the content-plan job queue (on-demand generation producer). */
export const CONTENT_PLAN_QUEUE = Symbol('CONTENT_PLAN_QUEUE');

/**
 * Build a BullMQ producer for `name` on a fresh Redis connection. BullMQ
 * requires `maxRetriesPerRequest: null` on the connection used by a queue.
 */
function createQueue(name: string): Queue {
  const connection = new IORedis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
  return new Queue(name, { connection });
}

/** Provides a BullMQ producer for the discovery queue (worker consumes it). */
export const discoveryQueueProvider: Provider = {
  provide: DISCOVERY_QUEUE,
  useFactory: () => createQueue(QUEUES.discovery),
};

/** Provides a BullMQ producer for inbound conversation messages from webhooks. */
export const conversationInboundQueueProvider: Provider = {
  provide: CONVERSATION_INBOUND_QUEUE,
  useFactory: () => createQueue(QUEUES.conversationInbound),
};

/** Provides a BullMQ producer that resumes paused automation runs after approval. */
export const automationResumeQueueProvider: Provider = {
  provide: AUTOMATION_RESUME_QUEUE,
  useFactory: () => createQueue(QUEUES.automationResume),
};

/** Provides a BullMQ producer for on-demand weekly content generation (worker consumes it). */
export const contentPlanQueueProvider: Provider = {
  provide: CONTENT_PLAN_QUEUE,
  useFactory: () => createQueue(QUEUES.contentPlan),
};
