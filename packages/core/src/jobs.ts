import type { SignalType } from './events';
import type { ContentFormat, ConversationChannel } from './enums';

/**
 * Shared job/queue contracts. Concrete queue wiring (BullMQ) lives in the worker
 * and API; these names + payload shapes are the contract both sides agree on.
 */
export const QUEUES = {
  discovery: 'discovery.run',
  brainReindex: 'brain.reindex',
  analyticsRollup: 'analytics.rollup',
  automationSignal: 'automation.signal',
  publish: 'publish.dispatch',
  conversationInbound: 'conversation.inbound',
  automationResume: 'automation.resume',
  contentPlan: 'content.plan',
  commentsPoll: 'comments.poll',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface DiscoveryJobData {
  orgId: string;
  websiteUrl?: string;
  social?: {
    provider: string;
    accountId: string;
    accessToken: string;
  };
}

/** Recompute derived intelligence (brand voice, audience, performance patterns). */
export interface ReindexJobData {
  orgId: string;
}

/** Daily analytics rollup + optimization pass. */
export interface AnalyticsJobData {
  orgId: string;
}

/** Poll an org's Instagram media for new comments and ingest them into the inbox. */
export interface CommentsPollJobData {
  orgId: string;
}

/** A signal handed to the Automation Engine to fire matching workflows. */
export interface AutomationSignalJobData {
  orgId: string;
  signal: { type: SignalType; payload?: Record<string, unknown> };
}

/** Dispatch a scheduled post to its platform. */
export interface PublishJobData {
  orgId: string;
  scheduledPostId: string;
}

/** An inbound conversation message (comment/DM) to route through the Conversation Engine. */
export interface ConversationInboundJobData {
  orgId: string;
  channel: ConversationChannel;
  externalThreadId: string;
  /**
   * Provider's unique id for THIS message/event (Messenger `mid`, WhatsApp
   * `message.id`, or `comment_id`). Dedups at-least-once webhook redelivery so a
   * re-sent message isn't stored — or replied to — twice.
   */
  messageExternalId?: string;
  contact?: { handle?: string; name?: string };
  text: string;
}

/** Resume a paused automation run after a human approval decision. */
export interface AutomationResumeJobData { orgId: string; runId: string; approved: boolean; }

/** Generate a week's worth of content on demand (defaults to the current week). */
export interface ContentPlanJobData {
  orgId: string;
  weekStartIso?: string;
  /** Owner-preferred content formats; absent = model's choice. */
  formats?: ContentFormat[];
}
