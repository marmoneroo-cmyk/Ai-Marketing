import { and, eq } from 'drizzle-orm';
import type { Database } from '@brandpilot/db';
import {
  ingestedAssets,
  knowledgeDocuments,
  customerPersonas,
  audienceSegments,
  objections,
} from '@brandpilot/db';
import type { BusinessBrain } from '@brandpilot/business-brain';
import type { AgentRuntime } from '@brandpilot/agent-runtime';
import {
  buildAudienceCorpus,
  buildAudiencePrompt,
  parseAudienceIntel,
} from './audience-analysis';

export interface AudienceIntelligenceDeps {
  db: Database;
  brain: BusinessBrain;
  runtime: AgentRuntime;
}

export interface AudienceBuildResult {
  personas: number;
  segments: number;
  objections: number;
}

const MODULE_ACTOR = 'audience-intelligence';
const DERIVED_CONFIDENCE = '0.600';
const CORPUS_LIMIT = 100;

/**
 * Module — audience modeling. Mines customer comments and knowledge documents to
 * synthesize personas, audience segments, and an objection library, persisting
 * each into the Business Brain's structured/derived layers. Org-scoped throughout.
 */
export class AudienceIntelligence {
  private readonly deps: AudienceIntelligenceDeps;

  constructor(deps: AudienceIntelligenceDeps) {
    this.deps = deps;
  }

  /**
   * Build personas, segments, and objections for an org from its audience corpus.
   * Returns the count of rows written to each table.
   */
  async buildPersonasAndSegments(orgId: string): Promise<AudienceBuildResult> {
    const corpus = await this.gatherCorpus(orgId);

    // Nothing to learn from → no LLM call, no writes.
    if (!corpus) return { personas: 0, segments: 0, objections: 0 };

    const result = await this.deps.runtime.run({
      orgId,
      actorId: MODULE_ACTOR,
      task: 'discovery_synthesis',
      prompt: buildAudiencePrompt(corpus),
    });
    const intel = parseAudienceIntel(result.output);

    const personas = await this.persistPersonas(orgId, intel.personas);
    const segments = await this.persistSegments(orgId, intel.segments);
    const objectionCount = await this.persistObjections(orgId, intel.objections);

    return { personas, segments, objections: objectionCount };
  }

  private async gatherCorpus(orgId: string): Promise<string> {
    const { db } = this.deps;

    const commentRows = await db
      .select({ raw: ingestedAssets.raw })
      .from(ingestedAssets)
      .where(and(eq(ingestedAssets.orgId, orgId), eq(ingestedAssets.kind, 'comment')))
      .limit(CORPUS_LIMIT);

    const docRows = await db
      .select({ content: knowledgeDocuments.content })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.orgId, orgId))
      .limit(CORPUS_LIMIT);

    const comments = commentRows.map((r) => extractCommentText(r.raw));
    const docs = docRows.map((r) => r.content);
    return buildAudienceCorpus([...comments, ...docs]);
  }

  private async persistPersonas(
    orgId: string,
    personas: ReturnType<typeof parseAudienceIntel>['personas'],
  ): Promise<number> {
    if (personas.length === 0) return 0;
    // Replace the prior DERIVED set — this recomputes daily, so appending would
    // accumulate duplicate personas forever (and skew the content planner that
    // reads them). Only `derived` rows are cleared; `discovery`/`manual` personas
    // are preserved. Skipped above when the new run produced none, so we never
    // wipe good data to replace it with nothing.
    await this.deps.db
      .delete(customerPersonas)
      .where(and(eq(customerPersonas.orgId, orgId), eq(customerPersonas.source, 'derived')));
    await this.deps.db.insert(customerPersonas).values(
      personas.map((p) => ({
        orgId,
        name: p.name || 'Persona',
        demographics: p.demographics,
        goals: p.goals,
        painPoints: p.painPoints,
        buyingTriggers: p.buyingTriggers,
        objections: p.objections,
        channels: p.channels,
        source: 'derived' as const,
        confidence: DERIVED_CONFIDENCE,
      })),
    );
    return personas.length;
  }

  private async persistSegments(
    orgId: string,
    segments: ReturnType<typeof parseAudienceIntel>['segments'],
  ): Promise<number> {
    if (segments.length === 0) return 0;
    // Segments are wholly derived + recomputed daily → replace the org's set so
    // the daily reindex refreshes rather than accumulating duplicates.
    await this.deps.db.delete(audienceSegments).where(eq(audienceSegments.orgId, orgId));
    await this.deps.db.insert(audienceSegments).values(
      segments.map((s) => ({
        orgId,
        name: s.name || 'Segment',
        criteria: s.criteria,
        interests: s.interests,
        confidence: DERIVED_CONFIDENCE,
        ...(s.sentiment !== null ? { sentiment: s.sentiment.toString() } : {}),
        ...(s.sizeEstimate !== null ? { sizeEstimate: s.sizeEstimate } : {}),
      })),
    );
    return segments.length;
  }

  private async persistObjections(
    orgId: string,
    items: ReturnType<typeof parseAudienceIntel>['objections'],
  ): Promise<number> {
    const valid = items.filter((o) => Boolean(o.objection));
    if (valid.length === 0) return 0;
    // Replace only the UNAPPROVED drafts — never delete an objection the owner has
    // APPROVED (that would silently drop curated, customer-facing knowledge). This
    // refreshes the daily draft set without unbounded duplication.
    await this.deps.db
      .delete(objections)
      .where(and(eq(objections.orgId, orgId), eq(objections.approved, false)));
    await this.deps.db.insert(objections).values(
      valid.map((o) => ({
        orgId,
        objection: o.objection,
        ...(o.rebuttal ? { rebuttal: o.rebuttal } : {}),
      })),
    );
    return valid.length;
  }
}

/** Pull comment text out of a stored ingested-asset `raw` payload. */
function extractCommentText(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (typeof r.text === 'string') return r.text;
    if (typeof r.message === 'string') return r.message;
    if (typeof r.comment === 'string') return r.comment;
    if (typeof r.body === 'string') return r.body;
  }
  return '';
}
