import type { ConversationChannel } from '@brandpilot/core';

/** Minimal contact hint carried on an inbound message (handle / display name). */
export interface InboundContact {
  handle?: string;
  name?: string;
}

/** A single inbound customer message arriving on a channel thread. */
export interface InboundMessage {
  channel: ConversationChannel;
  externalThreadId: string;
  /** Provider's unique id for this message — dedups at-least-once redelivery. */
  messageExternalId?: string;
  contact?: InboundContact;
  text: string;
}

/** Outcome of handling one inbound message: the conversation, its status, and any reply. */
export interface InboundResult {
  conversationId: string;
  status: string;
  reply?: string;
  escalated: boolean;
}

export type { ConversationChannel };
