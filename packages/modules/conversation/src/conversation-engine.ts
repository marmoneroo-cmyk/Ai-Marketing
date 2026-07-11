import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '@brandpilot/db';
import { conversations, conversationMessages, contacts, leads, organizations } from '@brandpilot/db';
import { AppError } from '@brandpilot/core';
import type { BusinessBrain } from '@brandpilot/business-brain';
import type { AgentRuntime } from '@brandpilot/agent-runtime';
import type { InboundContact, InboundMessage, InboundResult } from './types';
import { buildIntentPrompt, parseIntent } from './intent';

/** A generated reply ready to deliver to the customer on a specific thread. */
export interface SendReplyInput {
  channel: string;
  externalThreadId: string;
  text: string;
}

/**
 * Platform send adapter (e.g. Meta/WhatsApp send-message). Injected like the
 * other external transports (Stripe link, image render). When ABSENT, replies
 * are always drafted for owner review — never auto-delivered — regardless of
 * autonomy mode.
 */
export type SendReply = (input: SendReplyInput) => Promise<void>;

export interface ConversationEngineDeps {
  db: Database;
  brain: BusinessBrain;
  runtime: AgentRuntime;
  /** Optional outbound delivery adapter; absent → drafts only (see {@link SendReply}). */
  sendReply?: SendReply;
}

const ACTOR_ID = 'conversation';

/**
 * Module 5 — the always-on front desk. Ingests inbound customer messages from
 * comments and DMs, classifies intent, and drafts a grounded, brand-voiced reply
 * via the shared runtime. Customer-facing replies are approved-knowledge-only:
 * when grounding is insufficient (or a guardrail trips) the runtime throws and the
 * conversation is escalated to a human instead of guessing. Everything is org-scoped.
 */
export class ConversationEngine {
  private readonly deps: ConversationEngineDeps;

  constructor(deps: ConversationEngineDeps) {
    this.deps = deps;
  }

  /** Handle one inbound message: persist it, classify intent, and reply or escalate. */
  async handleInbound(orgId: string, input: InboundMessage): Promise<InboundResult> {
    const { db, brain, runtime } = this.deps;

    const contactId = await this.resolveContact(orgId, input.contact);
    const conversationId = await this.findOrCreateConversation(orgId, input, contactId);

    // Persist the inbound message, deduping on the provider's message id so an
    // at-least-once webhook redelivery neither duplicates the message nor fires a
    // second reply. With no message id we can't dedup, so it always inserts.
    const [inbound] = await db
      .insert(conversationMessages)
      .values({
        orgId,
        conversationId,
        direction: 'inbound',
        authorType: 'customer',
        body: input.text,
        ...(input.messageExternalId ? { externalId: input.messageExternalId } : {}),
      })
      .onConflictDoNothing()
      .returning({ id: conversationMessages.id });
    if (input.messageExternalId && !inbound) {
      // Already ingested this exact provider message — stop before re-processing.
      return { conversationId, status: 'duplicate_ignored', escalated: false };
    }

    await this.classifyIntent(orgId, conversationId, input.text);

    // First inbound from a contact becomes a CRM lead. This emits `lead_created`
    // — the entry point that drives the "Qualify new leads" automation
    // (qualify → briefing) and the analytics leads KPI. Best-effort: a CRM write
    // must never block the customer reply, so failures are swallowed + logged.
    if (contactId) {
      try {
        await this.ensureLead(orgId, contactId, input.channel);
      } catch {
        /* lead capture must not break the reply path */
      }
    }

    try {
      const res = await runtime.run({
        orgId,
        actorId: ACTOR_ID,
        task: 'reply',
        groundingQuery: input.text,
        prompt: `Reply helpfully to the customer message: ${input.text}`,
      });

      // Persist the AI reply (as a sent message or a draft, decided by autonomy).
      await db.insert(conversationMessages).values({
        orgId,
        conversationId,
        direction: 'outbound',
        authorType: 'agent',
        body: res.output,
        grounding: { citedChunkIds: res.citedChunkIds, confidence: res.confidence },
      });

      // Autonomy gate: only fully-autonomous orgs auto-DELIVER the reply, and only
      // when a platform send adapter is wired. Everyone else keeps it as a draft
      // for the owner to review + send from the inbox. This keeps the conversation
      // status HONEST — `ai_handling` (and the `message_sent` signal) means the
      // customer actually received a reply, never just that one was drafted.
      const sendReply = this.deps.sendReply;
      if (shouldAutoSend(await this.readAutonomy(orgId)) && sendReply) {
        try {
          await sendReply({
            channel: input.channel,
            externalThreadId: input.externalThreadId,
            text: res.output,
          });
          await db
            .update(conversations)
            .set({ status: 'ai_handling', lastMessageAt: new Date() })
            .where(eq(conversations.id, conversationId));
          await brain.recordSignal(orgId, {
            type: 'message_sent',
            subjectType: 'conversation',
            subjectId: conversationId,
          });
          return { conversationId, status: 'ai_handling', reply: res.output, escalated: false };
        } catch {
          /* delivery failed → fall through to the draft/needs-human path below */
        }
      }

      // Draft awaiting owner action (suggest/observe, no adapter, or send failed).
      await db
        .update(conversations)
        .set({ status: 'needs_human', lastMessageAt: new Date() })
        .where(eq(conversations.id, conversationId));

      return { conversationId, status: 'needs_human', reply: res.output, escalated: false };
    } catch (err) {
      if (err instanceof AppError && err.code === 'grounding_insufficient') {
        await db
          .update(conversations)
          .set({ status: 'needs_human', lastMessageAt: new Date() })
          .where(eq(conversations.id, conversationId));
        return { conversationId, status: 'needs_human', escalated: true };
      }
      throw err;
    }
  }

  /**
   * Classify the message intent and store it on the conversation. Best-effort:
   * the model returns JSON in `output`, parsed defensively; failures never block
   * the reply path.
   */
  private async classifyIntent(orgId: string, conversationId: string, text: string): Promise<void> {
    const { db, runtime } = this.deps;

    const result = await runtime.run({
      orgId,
      actorId: ACTOR_ID,
      task: 'intent_classification',
      prompt: buildIntentPrompt(text),
    });

    const intent = parseIntent(result.output);
    if (!intent) return;

    await db.update(conversations).set({ intent }).where(eq(conversations.id, conversationId));
  }

  /** Read the org's autonomy mode (defaults to the conservative `suggest`). */
  private async readAutonomy(orgId: string): Promise<string> {
    const [org] = await this.deps.db
      .select({ mode: organizations.autonomyMode })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return org?.mode ?? 'suggest';
  }

  /** Find the open thread for this channel/external id, or open a new one. */
  private async findOrCreateConversation(
    orgId: string,
    input: InboundMessage,
    contactId: string | null,
  ): Promise<string> {
    const { db } = this.deps;

    const [existing] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.orgId, orgId),
          eq(conversations.channel, input.channel),
          eq(conversations.externalThreadId, input.externalThreadId),
        ),
      )
      .limit(1);

    if (existing) return existing.id;

    const [created] = await db
      .insert(conversations)
      .values({
        orgId,
        channel: input.channel,
        externalThreadId: input.externalThreadId,
        status: 'open',
        lastMessageAt: new Date(),
        ...(contactId ? { contactId } : {}),
      })
      .onConflictDoNothing()
      .returning({ id: conversations.id });
    if (created) return created.id;

    // Lost a concurrent find-or-create race for the same thread (unique index) —
    // re-read the row the winner created so both inbounds share one conversation.
    const [raced] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.orgId, orgId),
          eq(conversations.channel, input.channel),
          eq(conversations.externalThreadId, input.externalThreadId),
        ),
      )
      .limit(1);
    return raced?.id ?? '';
  }

  /**
   * Find-or-create a lightweight contact from the inbound hint; returns its id
   * (or null). Dedupes by social handle so repeat messages from the same person
   * reuse one contact row instead of creating a duplicate each time.
   */
  private async resolveContact(orgId: string, contact?: InboundContact): Promise<string | null> {
    if (!contact || (!contact.handle && !contact.name)) return null;
    const { db } = this.deps;

    if (contact.handle) {
      const [existing] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(eq(contacts.orgId, orgId), sql`${contacts.handles}->>'social' = ${contact.handle}`),
        )
        .limit(1);
      if (existing) return existing.id;
    }

    const [created] = await db
      .insert(contacts)
      .values({
        orgId,
        ...(contact.name ? { name: contact.name } : {}),
        ...(contact.handle ? { handles: { social: contact.handle } } : {}),
      })
      .onConflictDoNothing()
      .returning({ id: contacts.id });
    if (created) return created.id;

    // Lost a concurrent insert race for the same social handle (unique index) —
    // re-read the row the winner created so both inbounds resolve to one contact.
    if (contact.handle) {
      const [existing] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(eq(contacts.orgId, orgId), sql`${contacts.handles}->>'social' = ${contact.handle}`),
        )
        .limit(1);
      return existing?.id ?? null;
    }
    return null;
  }

  /**
   * Ensure a contact has a CRM lead. The first inbound message from a contact
   * creates a `new` lead and records a `lead_created` signal — the entry point
   * that feeds the "Qualify new leads" automation and the analytics leads KPI.
   * Idempotent: a contact that already has a lead is left untouched, so repeat
   * messages never duplicate leads.
   */
  private async ensureLead(orgId: string, contactId: string, channel: string): Promise<void> {
    const { db, brain } = this.deps;

    const [existing] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.orgId, orgId), eq(leads.contactId, contactId)))
      .limit(1);
    if (existing) return;

    // onConflictDoNothing closes the check-then-insert race: if a concurrent
    // inbound for the same contact already inserted (the unique (org, contact)
    // constraint), this insert no-ops and returns no row — so `!leadId` below
    // means "lost the race", and we correctly skip a duplicate lead_created.
    const [lead] = await db
      .insert(leads)
      .values({ orgId, contactId, source: leadSourceForChannel(channel), status: 'new' })
      .onConflictDoNothing()
      .returning({ id: leads.id });

    const leadId = lead?.id;
    if (!leadId) return;

    // Payload threads BOTH ids so the automation's qualify(leadId) → briefing(contactId)
    // steps each receive the id they need.
    await brain.recordSignal(orgId, {
      type: 'lead_created',
      subjectType: 'lead',
      subjectId: leadId,
      payload: { leadId, contactId },
    });
  }
}

/**
 * Whether an org's autonomy mode permits auto-DELIVERING an AI reply to the
 * customer. Only the fully-autonomous modes send; `observe`/`suggest` draft the
 * reply for owner review instead.
 */
export function shouldAutoSend(autonomy: string): boolean {
  return autonomy === 'auto_scoped' || autonomy === 'auto_broad';
}

/** Map an inbound channel to the CRM lead `source` enum. */
export function leadSourceForChannel(
  channel: string,
): 'comment' | 'dm' | 'form' | 'discovery' | 'manual' {
  const c = channel.toLowerCase();
  if (c.includes('comment')) return 'comment';
  if (c === 'form' || c === 'web') return 'form';
  return 'dm';
}
