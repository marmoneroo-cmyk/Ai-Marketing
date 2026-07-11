import { and, eq } from 'drizzle-orm';
import type { Database } from '@brandpilot/db';
import { knowledgeDocuments, postMetrics, insights } from '@brandpilot/db';
import type { BusinessBrain, VoiceProfile } from '@brandpilot/business-brain';
import type { AgentRuntime } from '@brandpilot/agent-runtime';
import { buildCorpus, buildVoicePrompt, parseVoiceProfile } from './voice-analysis';
import {
  rankByEngagement,
  patternConfidence,
  type PostEngagement,
  type RankedPost,
} from './performance-analysis';

export interface BrandIntelligenceDeps {
  db: Database;
  brain: BusinessBrain;
  runtime: AgentRuntime;
}

const MODULE_NAME = 'brand-intelligence';
const KNOWLEDGE_LIMIT = 50;

/**
 * Module — brand voice + performance intelligence. Reads the org's authentic
 * material to infer a structured brand VoiceProfile (Business Brain Layer 4), and
 * mines historical post engagement into best/worst pattern insights. All work is
 * org-scoped and flows through the Business Brain / Agent Runtime SDKs.
 */
export class BrandIntelligence {
  private readonly deps: BrandIntelligenceDeps;

  constructor(deps: BrandIntelligenceDeps) {
    this.deps = deps;
  }

  /**
   * Infer the brand VoiceProfile from recent knowledge documents, persist it to
   * the Brain, record a metric signal, and return the profile.
   */
  async computeVoiceProfile(orgId: string): Promise<VoiceProfile> {
    const { db, brain, runtime } = this.deps;

    const docs = await db
      .select({ content: knowledgeDocuments.content })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.orgId, orgId))
      .limit(KNOWLEDGE_LIMIT);

    const corpus = buildCorpus(docs.map((d) => d.content));

    // Nothing learned yet → empty profile, no LLM call.
    const profile = corpus
      ? parseVoiceProfile(
          (
            await runtime.run({
              orgId,
              actorId: MODULE_NAME,
              task: 'discovery_synthesis',
              prompt: buildVoicePrompt(corpus),
            })
          ).output,
        )
      : parseVoiceProfile('');

    await brain.setVoiceProfile(orgId, profile);

    await brain.recordSignal(orgId, {
      type: 'metric_snapshot',
      subjectType: 'voice_profile',
      payload: {
        confidence: profile.confidence,
        doExamples: profile.doExamples.length,
        dontExamples: profile.dontExamples.length,
      },
      value: profile.confidence,
    });

    return profile;
  }

  /**
   * Rank historical posts by engagement and write best/worst pattern insights.
   * Ranking is deterministic in code; returns the number of insights written.
   */
  async analyzePerformance(orgId: string): Promise<number> {
    const { db } = this.deps;

    const rows = await db
      .select({
        externalPostId: postMetrics.externalPostId,
        platform: postMetrics.platform,
        likes: postMetrics.likes,
        comments: postMetrics.comments,
        shares: postMetrics.shares,
      })
      .from(postMetrics)
      .where(eq(postMetrics.orgId, orgId));

    const posts: PostEngagement[] = rows.map((r) => ({
      externalPostId: r.externalPostId,
      platform: r.platform,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
    }));

    const ranked = rankByEngagement(posts);
    if (ranked.length === 0) return 0;

    // Replace the prior pattern insights — this recomputes on every daily reindex,
    // so appending would accumulate duplicate patterns forever and skew the content
    // planner + dashboard that read them. Scoped to (org, kind='pattern') so other
    // insight kinds (recommendations, customer-prep) are untouched. Only reached
    // when there IS fresh data (ranked.length > 0), so we never wipe with nothing.
    await this.deps.db
      .delete(insights)
      .where(and(eq(insights.orgId, orgId), eq(insights.kind, 'pattern')));

    const confidence = patternConfidence(ranked.length);
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];

    let written = 0;
    if (best) {
      await this.writePatternInsight(orgId, 'Top-performing post pattern', best, ranked.length, confidence);
      written++;
    }
    // Only emit a distinct "worst" insight when it is a different post.
    if (worst && worst !== best) {
      await this.writePatternInsight(orgId, 'Lowest-performing post pattern', worst, ranked.length, confidence);
      written++;
    }

    return written;
  }

  private async writePatternInsight(
    orgId: string,
    title: string,
    post: RankedPost,
    sampleSize: number,
    confidence: string,
  ): Promise<void> {
    await this.deps.db.insert(insights).values({
      orgId,
      module: MODULE_NAME,
      kind: 'pattern',
      title,
      body: `${post.platform} post scored ${post.engagement} engagement (likes + comments + shares) across ${sampleSize} analyzed posts.`,
      evidence: {
        platform: post.platform,
        engagement: post.engagement,
        sampleSize,
        ...(post.externalPostId ? { externalPostId: post.externalPostId } : {}),
      },
      confidence,
    });
  }
}
