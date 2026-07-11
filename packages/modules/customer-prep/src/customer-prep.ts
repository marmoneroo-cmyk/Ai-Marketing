import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '@brandpilot/db';
import { contacts, conversations, conversationMessages, insights } from '@brandpilot/db';
import type { BusinessBrain } from '@brandpilot/business-brain';
import type { AgentRuntime } from '@brandpilot/agent-runtime';
import type { BriefingResult } from './types';
import { buildBriefingPrompt, parseBriefing } from './briefing';

/** How many recent messages to feed into the briefing prompt. */
const RECENT_MESSAGE_LIMIT = 20;

export interface CustomerPrepDeps {
  db: Database;
  brain: BusinessBrain;
  runtime: AgentRuntime;
}

/**
 * Module — pre-meeting intelligence. Gathers what the business already knows about a
 * contact (profile, recent conversation history, and grounded semantic memory) and
 * distills it into a concise briefing with concrete talking points, persisted as a
 * `customer-prep` recommendation insight. Everything is org-scoped.
 */
export class CustomerPrep {
  private readonly deps: CustomerPrepDeps;

  constructor(deps: CustomerPrepDeps) {
    this.deps = deps;
  }

  /** Build a pre-meeting briefing for a contact and persist it as an insight. */
  async buildBriefing(orgId: string, contactId: string): Promise<BriefingResult> {
    const { db, brain, runtime } = this.deps;

    const [contact] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId)))
      .limit(1);
    if (!contact) throw new Error(`Contact ${contactId} not found`);

    const messageRows = await db
      .select({ body: conversationMessages.body })
      .from(conversationMessages)
      .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
      .where(and(eq(conversationMessages.orgId, orgId), eq(conversations.contactId, contactId)))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(RECENT_MESSAGE_LIMIT);

    const recentMessages = messageRows
      .map((m) => m.body)
      .filter((b): b is string => typeof b === 'string' && b.length > 0);

    const contactSummaryQuery = `Everything known about the contact ${contact.name ?? contactId}`;
    const grounded = await brain.retrieve(orgId, contactSummaryQuery);
    const grounding = grounded.chunks.map((c) => c.content).join('\n\n');

    const prompt = buildBriefingPrompt({
      name: contact.name ?? '',
      recentMessages,
      grounding,
    });

    // Pass the retrieval query to the runtime so citations + grounding
    // confidence on the result are REAL (previously citedChunkIds was empty).
    const result = await runtime.run({
      orgId,
      actorId: 'customer-prep',
      task: 'briefing',
      prompt,
      groundingQuery: contactSummaryQuery,
    });
    const briefing = parseBriefing(result.output);

    await db.insert(insights).values({
      orgId,
      module: 'customer-prep',
      kind: 'recommendation',
      title: `Briefing: ${contact.name ?? contactId}`,
      body: briefing.summary,
      evidence: {
        interests: briefing.interests,
        businessSummary: briefing.businessSummary,
        citedChunkIds: result.citedChunkIds,
        rationale: result.rationale,
        // Buying-intent estimate is a briefing signal, NOT grounding confidence.
        intentEstimate: briefing.intentEstimate,
      },
      // Store the REAL grounding confidence here (not the buying-intent estimate).
      confidence: result.confidence.toFixed(3),
    });

    return { summary: briefing.summary, talkingPoints: briefing.talkingPoints };
  }
}
