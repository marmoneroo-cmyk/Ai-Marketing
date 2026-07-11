import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { QUEUES, type ConversationInboundJobData } from '@brandpilot/core';
import type { WorkerContext } from '../context';

/**
 * Route an inbound comment/DM through the Conversation Engine: it persists the
 * message, classifies intent, and replies or escalates. A successful reply emits
 * conversation signals which — via the signal bridge — can fire automations.
 */
export function createConversationWorker(
  ctx: WorkerContext,
  connection: IORedis,
): Worker<ConversationInboundJobData> {
  return new Worker<ConversationInboundJobData>(
    QUEUES.conversationInbound,
    async (job: Job<ConversationInboundJobData>) => {
      const { orgId, channel, externalThreadId, messageExternalId, contact, text } = job.data;
      return ctx.conversation.handleInbound(orgId, {
        channel,
        externalThreadId,
        text,
        ...(messageExternalId === undefined ? {} : { messageExternalId }),
        ...(contact === undefined ? {} : { contact }),
      });
    },
    { connection, concurrency: 4 },
  );
}
