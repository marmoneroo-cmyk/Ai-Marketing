import { Global, Module } from '@nestjs/common';
import {
  discoveryQueueProvider,
  DISCOVERY_QUEUE,
  conversationInboundQueueProvider,
  CONVERSATION_INBOUND_QUEUE,
  automationResumeQueueProvider,
  AUTOMATION_RESUME_QUEUE,
  contentPlanQueueProvider,
  CONTENT_PLAN_QUEUE,
} from './queue.provider';

/** Global module exposing job-queue producers under their tokens. */
@Global()
@Module({
  providers: [
    discoveryQueueProvider,
    conversationInboundQueueProvider,
    automationResumeQueueProvider,
    contentPlanQueueProvider,
  ],
  exports: [
    DISCOVERY_QUEUE,
    CONVERSATION_INBOUND_QUEUE,
    AUTOMATION_RESUME_QUEUE,
    CONTENT_PLAN_QUEUE,
  ],
})
export class QueueModule {}
