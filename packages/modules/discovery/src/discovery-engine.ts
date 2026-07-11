import { and, eq } from 'drizzle-orm';
import type { Database } from '@brandpilot/db';
import { discoveryRuns, ingestedAssets, customerPersonas, competitors, knowledgeDocuments } from '@brandpilot/db';
import type { BusinessBrain } from '@brandpilot/business-brain';
import type { AgentRuntime } from '@brandpilot/agent-runtime';
import type { DiscoverySources, DnaResult, SynthesizedDna } from './types';
import { buildDnaPrompt, parseDna, computeCompleteness } from './dna-synthesis';

export interface DiscoveryDeps {
  db: Database;
  brain: BusinessBrain;
  runtime: AgentRuntime;
  /** Website scraper (Firecrawl adapter from @brandpilot/connectors). */
  scrapeUrl: (url: string) => Promise<{ title?: string; markdown: string }>;
}

type AssetKind = 'post' | 'reel' | 'story' | 'image' | 'video' | 'comment' | 'review' | 'page';
const ALLOWED_KINDS: readonly AssetKind[] = ['post', 'reel', 'story', 'image', 'video', 'comment', 'review', 'page'];

/**
 * Module 2 — the onboarding wedge. Ingests a business's public footprint into the
 * Business Brain, then synthesizes a structured Business DNA (profile, personas,
 * competitors) with Claude. Everything it learns is org-scoped and source-cited.
 */
export class DiscoveryEngine {
  private readonly deps: DiscoveryDeps;

  constructor(deps: DiscoveryDeps) {
    this.deps = deps;
  }

  async run(orgId: string, sources: DiscoverySources): Promise<DnaResult> {
    const { db, brain } = this.deps;

    const [run] = await db
      .insert(discoveryRuns)
      .values({ orgId, status: 'running', sources: sourceLabels(sources), startedAt: new Date() })
      .returning();
    const runId = run?.id ?? '';

    try {
      let knowledgeDocs = 0;
      if (sources.websiteUrl) knowledgeDocs += await this.ingestWebsite(orgId, sources.websiteUrl);
      if (sources.social) knowledgeDocs += await this.ingestSocial(orgId, runId, sources.social);

      const dna = await this.synthesize(orgId);
      await this.persistDna(orgId, dna);

      await brain.recordSignal(orgId, {
        type: 'metric_snapshot',
        subjectType: 'discovery_run',
        ...(runId ? { subjectId: runId } : {}),
        payload: { knowledgeDocs, personas: dna.personas.length, competitors: dna.competitors.length },
      });

      if (runId) {
        await db
          .update(discoveryRuns)
          .set({
            status: 'done',
            finishedAt: new Date(),
            stats: { knowledgeDocs, personas: dna.personas.length, competitors: dna.competitors.length },
          })
          .where(eq(discoveryRuns.id, runId));
      }

      return {
        runId,
        profile: { description: dna.description, mission: dna.mission, usp: dna.usp, categories: dna.categories },
        personaCount: dna.personas.length,
        competitorCount: dna.competitors.length,
        knowledgeDocs,
      };
    } catch (err) {
      if (runId) {
        await db
          .update(discoveryRuns)
          .set({ status: 'failed', finishedAt: new Date(), stats: { error: errorMessage(err) } })
          .where(eq(discoveryRuns.id, runId));
      }
      throw err;
    }
  }

  private async ingestWebsite(orgId: string, url: string): Promise<number> {
    const page = await this.deps.scrapeUrl(url);
    if (!page.markdown.trim()) return 0;
    await this.deps.brain.upsertKnowledge(orgId, {
      sourceKind: 'website_page',
      externalRef: url,
      ...(page.title ? { title: page.title } : {}),
      content: page.markdown,
    });
    return 1;
  }

  private async ingestSocial(
    orgId: string,
    runId: string,
    social: NonNullable<DiscoverySources['social']>,
  ): Promise<number> {
    const items = await social.connector.pull('media', {
      accountId: social.accountId,
      accessToken: social.accessToken,
    });

    let docs = 0;
    for (const item of items) {
      await this.deps.db
        .insert(ingestedAssets)
        .values({
          orgId,
          ...(runId ? { runId } : {}),
          provider: social.provider,
          kind: mapKind(item.kind),
          externalId: item.externalId ?? null,
          raw: (item.raw as Record<string, unknown>) ?? {},
          metrics: (item.metrics as Record<string, unknown>) ?? {},
          capturedAt: item.capturedAt ?? new Date(),
        })
        .onConflictDoNothing();

      const caption = extractCaption(item.raw);
      if (caption) {
        await this.deps.brain.upsertKnowledge(orgId, {
          sourceKind: `${social.provider}_post`,
          ...(item.externalId ? { externalRef: item.externalId } : {}),
          content: caption,
        });
        docs++;
      }
    }
    return docs;
  }

  private async synthesize(orgId: string): Promise<SynthesizedDna> {
    const docs = await this.deps.db
      .select({ content: knowledgeDocuments.content })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.orgId, orgId))
      // Deterministic order (oldest first). The website page is ingested before
      // social, so ascending keeps that richest source in the capped window
      // instead of letting an unordered LIMIT drop it for an org with >50 docs.
      .orderBy(knowledgeDocuments.createdAt)
      .limit(50);

    const corpus = docs.map((d) => d.content).join('\n\n').trim();
    if (!corpus) return parseDna(''); // nothing learned yet → empty DNA, no LLM call

    const result = await this.deps.runtime.run({
      orgId,
      actorId: 'discovery-engine',
      task: 'discovery_synthesis',
      prompt: buildDnaPrompt(corpus),
    });
    return parseDna(result.output);
  }

  private async persistDna(orgId: string, dna: SynthesizedDna): Promise<void> {
    await this.deps.brain.facts.upsertBusinessProfile(orgId, {
      description: dna.description || null,
      mission: dna.mission || null,
      vision: dna.vision || null,
      usp: dna.usp || null,
      categories: dna.categories,
      completeness: computeCompleteness(dna).toString(),
    });

    // Batch each set into a single multi-row INSERT (was one INSERT per persona
    // /competitor — an N+1 during discovery/onboarding).
    // Replace-not-append so re-running discovery refreshes rather than
    // duplicating (the DERIVED personas from the daily audience reindex are
    // managed separately, keyed on `source`, so they are untouched here).
    if (dna.personas.length > 0) {
      await this.deps.db
        .delete(customerPersonas)
        .where(and(eq(customerPersonas.orgId, orgId), eq(customerPersonas.source, 'discovery')));
      await this.deps.db.insert(customerPersonas).values(
        dna.personas.map((p) => ({
          orgId,
          name: p.name || 'Persona',
          demographics: p.demographics ?? {},
          goals: p.goals ?? [],
          painPoints: p.painPoints ?? [],
          buyingTriggers: p.buyingTriggers ?? [],
          objections: p.objections ?? [],
          channels: p.channels ?? [],
          source: 'discovery' as const,
          confidence: '0.600',
        })),
      );
    }

    if (dna.competitors.length > 0) {
      await this.deps.db.delete(competitors).where(eq(competitors.orgId, orgId));
      await this.deps.db.insert(competitors).values(
        dna.competitors.map((c) => ({
          orgId,
          name: c.name || 'Competitor',
          positioning: c.positioning ?? null,
          strengths: c.strengths ?? [],
          weaknesses: c.weaknesses ?? [],
        })),
      );
    }
  }
}

function sourceLabels(sources: DiscoverySources): string[] {
  const labels: string[] = [];
  if (sources.websiteUrl) labels.push('website');
  if (sources.social) labels.push(sources.social.provider);
  return labels;
}

function mapKind(kind: string): AssetKind {
  return (ALLOWED_KINDS as readonly string[]).includes(kind) ? (kind as AssetKind) : 'post';
}

function extractCaption(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (typeof r.caption === 'string') return r.caption;
    if (typeof r.message === 'string') return r.message;
    if (typeof r.text === 'string') return r.text;
  }
  return '';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
