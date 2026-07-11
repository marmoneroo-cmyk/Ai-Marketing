import { pgTable, uuid, text, numeric, jsonb, timestamp, index, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { ConversationChannel } from '@brandpilot/core';
import { primaryId } from './_shared';
import { users, orgRef } from './identity';

/** Conversation AI: grounded, brand-voiced replies across comments and DMs. */

export const conversations = pgTable(
  'conversations',
  {
    id: primaryId(),
    orgId: orgRef(),
    channel: text('channel').$type<ConversationChannel>().notNull(),
    externalThreadId: text('external_thread_id'),
    contactId: uuid('contact_id'), // FK to contacts (crm.ts), nullable until identified — soft link
    status: text('status')
      .$type<'open' | 'ai_handling' | 'needs_human' | 'closed'>()
      .notNull()
      .default('open'),
    intent: text('intent'),
    sentiment: numeric('sentiment'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('conversations_org_status_last_msg_idx').on(t.orgId, t.status, t.lastMessageAt),
    // One conversation per (org, channel, thread): stops concurrent inbound
    // messages for the same thread from racing the find-or-create into duplicate
    // threads, and serves that lookup. NULL thread ids stay distinct.
    unique('conversations_org_channel_thread_uq').on(t.orgId, t.channel, t.externalThreadId),
  ],
);

export const conversationMessages = pgTable('conversation_messages', {
  id: primaryId(),
  orgId: orgRef(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  direction: text('direction').$type<'inbound' | 'outbound'>().notNull(),
  authorType: text('author_type').$type<'customer' | 'agent' | 'human'>().notNull(),
  body: text('body'),
  attachments: jsonb('attachments').notNull().default([]),
  grounding: jsonb('grounding'), // cited chunks + confidence (outbound only)
  externalId: text('external_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // Idempotency for at-least-once webhook redelivery: one inbound row per provider
  // message id. Partial — agent drafts have no externalId and stay unconstrained.
  uniqueIndex('conv_msg_org_external_uq')
    .on(t.orgId, t.externalId)
    .where(sql`${t.externalId} IS NOT NULL`),
  // Inbox thread view filters (orgId, conversationId) ORDER BY createdAt DESC LIMIT 50.
  // The partial unique index above doesn't serve this (it's keyed on externalId).
  index('conversation_messages_org_conv_created_idx').on(t.orgId, t.conversationId, t.createdAt),
]);
