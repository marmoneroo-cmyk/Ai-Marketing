import { and, cosineDistance, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '@brandpilot/db';
import { knowledgeSources, knowledgeDocuments, knowledgeChunks, signals, brandVoiceProfiles, brandKits, faqs, policies, objections } from '@brandpilot/db';
import type { Cache, SignalInput } from '@brandpilot/core';
import { RETRIEVAL_TOP_K } from '@brandpilot/config';
import type {
  BrandKit,
  Embedder,
  GroundedContext,
  Permission,
  RetrievedChunk,
  RetrieveOptions,
  UpsertKnowledgeInput,
  VoiceProfile,
} from './types';
import { chunkText } from './chunking';
import { createFacts, type Facts } from './facts';

/** TTL for derived-intel / profile reads that change rarely (seconds). */
const CACHE_TTL_SECONDS = 300;
/** Org-scoped cache keys; one namespace per read-through accessor. */
const voiceKey = (orgId: string): string => `bb:voice:${orgId}`;
const brandKitKey = (orgId: string): string => `bb:brandkit:${orgId}`;
const profileKey = (orgId: string): string => `bb:profile:${orgId}`;

export interface BusinessBrainDeps {
  db: Database;
  embedder: Embedder;
  /** Optional hook fired after a signal is durably recorded (e.g. enqueue automation). */
  signalSink?: (orgId: string, signal: SignalInput) => void | Promise<void>;
  /** Optional read-through cache for hot, rarely-changing reads (voice/brand kit/profile). */
  cache?: Cache;
}

/**
 * The single source of truth. Every module reads and writes the business model
 * through this SDK — never by touching Brain tables directly.
 *
 * Four memory layers (docs/01-system-architecture.md §4):
 *   1. structured facts  →  `.facts`
 *   2. semantic memory   →  `retrieve` / `upsertKnowledge`
 *   3. episodic signals  →  `recordSignal`
 *   4. derived intel     →  `getVoiceProfile` / `setVoiceProfile`
 */
export class BusinessBrain {
  private readonly db: Database;
  private readonly embedder: Embedder;
  private readonly signalSink: ((orgId: string, signal: SignalInput) => void | Promise<void>) | undefined;
  private readonly cache: Cache | undefined;
  readonly facts: Facts;

  constructor(deps: BusinessBrainDeps) {
    this.db = deps.db;
    this.embedder = deps.embedder;
    this.signalSink = deps.signalSink;
    this.cache = deps.cache;
    this.facts = createFacts(deps.db);
  }

  /**
   * Read-through helper: return cached `key` if present, else run `load`, cache
   * the result (skipping nulls), and return it. Cache transport failures never
   * break the operation — they fall back to `load`.
   */
  private async readThrough<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.cache) return load();
    try {
      const cached = await this.cache.get<T>(key);
      if (cached !== null) return cached;
    } catch {
      /* cache read failure must not break the operation */
    }
    const value = await load();
    if (value !== null) {
      try {
        await this.cache.set(key, value, CACHE_TTL_SECONDS);
      } catch {
        /* cache write failure must not break the operation */
      }
    }
    return value;
  }

  /** Best-effort cache invalidation; never throws. */
  private async invalidate(key: string): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.del(key);
    } catch {
      /* cache invalidation failure must not break the write */
    }
  }

  /** Layer 2 — semantic retrieval (cosine similarity) with grounding confidence. */
  async retrieve(orgId: string, query: string, opts: RetrieveOptions = {}): Promise<GroundedContext> {
    const topK = opts.topK ?? RETRIEVAL_TOP_K;
    const minScore = opts.minScore ?? 0;

    const [queryEmbedding] = await this.embedder.embed([query]);
    if (!queryEmbedding) return { chunks: [], confidence: 0 };

    // 1 - cosine distance = cosine similarity in [0,1].
    const similarity = sql<number>`1 - (${cosineDistance(knowledgeChunks.embedding, queryEmbedding)})`;

    const rows = await this.db
      .select({
        id: knowledgeChunks.id,
        documentId: knowledgeChunks.documentId,
        content: knowledgeChunks.content,
        score: similarity,
        metadata: knowledgeChunks.metadata,
      })
      .from(knowledgeChunks)
      .where(and(eq(knowledgeChunks.orgId, orgId), gt(similarity, minScore)))
      .orderBy(desc(similarity))
      .limit(topK);

    const chunks: RetrievedChunk[] = rows.map((r) => {
      const meta = (r.metadata ?? {}) as { kind?: string; permission?: Permission };
      return {
        id: r.id,
        documentId: r.documentId,
        content: r.content,
        score: Number(r.score),
        sourceKind: meta.kind ?? 'unknown',
        permission: meta.permission ?? 'public',
      };
    });

    const confidence = chunks.length
      ? chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length
      : 0;
    return { chunks, confidence };
  }

  /**
   * Layer 2 — chunk, embed, and store a piece of knowledge (source + doc + chunks).
   *
   * Idempotent by `externalRef`: when the caller supplies a stable ref (e.g. a
   * page URL or a post's external id), any prior version of that source is
   * replaced instead of appended — so re-running discovery on the same footprint
   * refreshes knowledge rather than duplicating it (duplicates would pollute
   * retrieval and skew grounding confidence). Refs cascade to documents +
   * chunks via ON DELETE CASCADE. Calls without an `externalRef` still append.
   */
  async upsertKnowledge(orgId: string, input: UpsertKnowledgeInput): Promise<void> {
    const pieces = chunkText(input.content);
    if (pieces.length === 0) return;

    const permission = input.permission ?? 'public';
    const externalRef = input.externalRef ?? null;

    // Embed FIRST: this is the only network step, so computing it before any
    // write means a failure never leaves orphaned source/doc rows, and (on
    // re-index) never deletes old knowledge without a replacement ready.
    const embeddings = await this.embedder.embed(pieces);

    // Idempotent re-index: drop the prior version of this ref before inserting.
    if (externalRef !== null) {
      await this.db
        .delete(knowledgeSources)
        .where(and(eq(knowledgeSources.orgId, orgId), eq(knowledgeSources.externalRef, externalRef)));
    }

    const [source] = await this.db
      .insert(knowledgeSources)
      .values({
        orgId,
        kind: input.sourceKind,
        externalRef,
        permission,
        fetchedAt: new Date(),
      })
      .returning();

    const [doc] = await this.db
      .insert(knowledgeDocuments)
      .values({
        orgId,
        sourceId: source?.id ?? null,
        title: input.title ?? null,
        content: input.content,
        lang: input.lang ?? null,
      })
      .returning();
    if (!doc) return;

    const rows = [];
    for (let i = 0; i < pieces.length; i++) {
      const content = pieces[i];
      const embedding = embeddings[i];
      if (!content || !embedding) continue;
      rows.push({
        orgId,
        documentId: doc.id,
        chunkIndex: i,
        content,
        embedding,
        metadata: { kind: input.sourceKind, permission },
      });
    }
    if (rows.length > 0) await this.db.insert(knowledgeChunks).values(rows);
  }

  /**
   * Index the owner's APPROVED structured knowledge — FAQs, policies, and
   * objection rebuttals — into the semantic pool, so customer-facing tasks
   * (`reply`, `objection`) ground on the business's own curated answers rather
   * than only scraped website content. Without this, `listApprovedFaqs` /
   * `listPolicies` are dead accessors that never reach retrieval.
   *
   * Only APPROVED items are indexed, and only as `public` (they are, by
   * definition, answers the owner is willing to give customers). Idempotent per
   * item via a stable `externalRef` (`faq:<id>` etc.) so the daily reindex
   * refreshes rather than duplicates. Returns the count indexed.
   */
  async indexApprovedKnowledge(orgId: string): Promise<number> {
    const [approvedFaqs, approvedPolicies, approvedObjections] = await Promise.all([
      this.db.select().from(faqs).where(and(eq(faqs.orgId, orgId), eq(faqs.approved, true))),
      this.db.select().from(policies).where(and(eq(policies.orgId, orgId), eq(policies.approved, true))),
      this.db.select().from(objections).where(and(eq(objections.orgId, orgId), eq(objections.approved, true))),
    ]);

    let indexed = 0;

    for (const f of approvedFaqs) {
      await this.upsertKnowledge(orgId, {
        content: `Q: ${f.question}\nA: ${f.answer}`,
        sourceKind: 'faq',
        permission: 'public',
        externalRef: `faq:${f.id}`,
        title: f.question,
      });
      indexed++;
    }

    for (const p of approvedPolicies) {
      await this.upsertKnowledge(orgId, {
        content: `${p.kind} policy:\n${p.body}`,
        sourceKind: 'policy',
        permission: 'public',
        externalRef: `policy:${p.id}`,
        title: `${p.kind} policy`,
      });
      indexed++;
    }

    for (const o of approvedObjections) {
      // An objection with no rebuttal has no answer to ground on — skip it.
      if (!o.rebuttal) continue;
      await this.upsertKnowledge(orgId, {
        content: `Objection: ${o.objection}\nResponse: ${o.rebuttal}`,
        sourceKind: 'objection',
        permission: 'public',
        externalRef: `objection:${o.id}`,
        title: o.objection,
      });
      indexed++;
    }

    return indexed;
  }

  /** Layer 3 — append an episodic signal (learning + automation trigger). */
  async recordSignal(orgId: string, signal: SignalInput): Promise<void> {
    await this.db.insert(signals).values({
      orgId,
      type: signal.type,
      subjectType: signal.subjectType ?? null,
      subjectId: signal.subjectId ?? null,
      payload: signal.payload ?? {},
      value: signal.value !== undefined ? signal.value.toString() : null,
      occurredAt: signal.occurredAt ?? new Date(),
    });
    if (this.signalSink) {
      try {
        await this.signalSink(orgId, signal);
      } catch {
        /* sink failure must not break recording */
      }
    }
  }

  /** Layer 1 — read the derived brand kit (colors, fonts, logo, notes). Cached. */
  async getBrandKit(orgId: string): Promise<BrandKit | null> {
    return this.readThrough(brandKitKey(orgId), async () => {
      const [row] = await this.db
        .select({
          colors: brandKits.colors,
          fonts: brandKits.fonts,
          logoAssetId: brandKits.logoAssetId,
          designNotes: brandKits.designNotes,
        })
        .from(brandKits)
        .where(eq(brandKits.orgId, orgId))
        .limit(1);
      if (!row) return null;
      return {
        colors: (row.colors as unknown[]) ?? [],
        fonts: (row.fonts as unknown[]) ?? [],
        logoAssetId: row.logoAssetId ?? null,
        designNotes: row.designNotes ?? null,
      };
    });
  }

  /** Layer 1 — read the structured business profile. Cached read-through. */
  async getBusinessProfile(orgId: string): ReturnType<Facts['getBusinessProfile']> {
    return this.readThrough(profileKey(orgId), () => this.facts.getBusinessProfile(orgId));
  }

  /** Layer 1 — write the structured business profile, then invalidate its cache. */
  async upsertBusinessProfile(
    orgId: string,
    patch: Parameters<Facts['upsertBusinessProfile']>[1],
  ): ReturnType<Facts['upsertBusinessProfile']> {
    const row = await this.facts.upsertBusinessProfile(orgId, patch);
    await this.invalidate(profileKey(orgId));
    return row;
  }

  /** Layer 4 — read the derived brand voice profile. Cached read-through. */
  async getVoiceProfile(orgId: string): Promise<VoiceProfile | null> {
    return this.readThrough(voiceKey(orgId), async () => {
      const [row] = await this.db
        .select()
        .from(brandVoiceProfiles)
        .where(eq(brandVoiceProfiles.orgId, orgId))
        .limit(1);
      if (!row) return null;
      return {
        personality: (row.personality ?? {}) as Record<string, unknown>,
        tone: (row.tone ?? {}) as Record<string, unknown>,
        vocabulary: (row.vocabulary ?? {}) as Record<string, unknown>,
        doExamples: (row.doExamples ?? []) as string[],
        dontExamples: (row.dontExamples ?? []) as string[],
        confidence: Number(row.confidence ?? 0),
      };
    });
  }

  /** Layer 4 — write the derived brand voice profile (computed by Brand Intelligence). */
  async setVoiceProfile(orgId: string, profile: VoiceProfile): Promise<void> {
    const values = {
      personality: profile.personality,
      tone: profile.tone,
      vocabulary: profile.vocabulary,
      doExamples: profile.doExamples,
      dontExamples: profile.dontExamples,
      confidence: profile.confidence.toString(),
    };
    await this.db
      .insert(brandVoiceProfiles)
      .values({ orgId, ...values })
      .onConflictDoUpdate({
        target: brandVoiceProfiles.orgId,
        set: { ...values, computedAt: new Date() },
      });
    await this.invalidate(voiceKey(orgId));
  }
}
