import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '@brandpilot/db';
import { insights, postMetrics } from '@brandpilot/db';
import type { AgentRuntime } from '@brandpilot/agent-runtime';
import type { AnalyzeResult, OptimizationMetricRow, OptimizationSignals } from './types';
import { buildRecommendationPrompt, computeSignals, parseRecommendations } from './optimization-math';

const RECENT_POST_LIMIT = 200;

export interface OptimizationDeps {
  db: Database;
  runtime: AgentRuntime;
}

/**
 * Module — optimization. Reads an org's recent post metrics, derives
 * deterministic performance signals (best posting hour, top hashtags, best
 * format) in `optimization-math.ts`, then asks the reasoning-tier model to turn
 * ONLY those computed facts into concrete recommendations. Model output is parsed
 * defensively and persisted as `insights` rows for human review.
 */
export class OptimizationEngine {
  private readonly db: Database;
  private readonly runtime: AgentRuntime;

  constructor(deps: OptimizationDeps) {
    this.db = deps.db;
    this.runtime = deps.runtime;
  }

  /** Analyze recent performance and persist grounded recommendations. */
  async analyze(orgId: string): Promise<AnalyzeResult> {
    const rows = await this.loadRecentPostMetrics(orgId);
    const signals = computeSignals(rows);
    if (signals.sampleSize === 0) return { recommendations: 0 };

    const result = await this.runtime.run({
      orgId,
      actorId: 'optimization-engine',
      task: 'optimization_analysis',
      prompt: buildRecommendationPrompt(signals),
    });

    const recommendations = parseRecommendations(result.output);
    if (recommendations.length === 0) return { recommendations: 0 };

    // Replace the prior recommendations — this recomputes on every daily analytics
    // run, so appending would accumulate duplicate recs forever (and the dashboard
    // reads them directly). Scoped to (org, kind='recommendation') so other insight
    // kinds are untouched; only reached when there ARE fresh recs (never wipe with
    // nothing).
    await this.db
      .delete(insights)
      .where(and(eq(insights.orgId, orgId), eq(insights.kind, 'recommendation')));

    // Batch the recommendations into a single INSERT (was one per row — an N+1).
    const evidence = toEvidence(signals);
    await this.db.insert(insights).values(
      recommendations.map((rec) => ({
        orgId,
        module: 'optimization' as const,
        kind: 'recommendation' as const,
        title: rec.title,
        body: rec.body || null,
        evidence,
        confidence: rec.confidence.toFixed(3),
      })),
    );

    return { recommendations: recommendations.length };
  }

  private async loadRecentPostMetrics(orgId: string): Promise<OptimizationMetricRow[]> {
    const rows = await this.db
      .select({
        externalPostId: postMetrics.externalPostId,
        platform: postMetrics.platform,
        capturedAt: postMetrics.capturedAt,
        likes: postMetrics.likes,
        comments: postMetrics.comments,
        shares: postMetrics.shares,
        raw: postMetrics.raw,
      })
      .from(postMetrics)
      .where(eq(postMetrics.orgId, orgId))
      .orderBy(desc(postMetrics.capturedAt))
      .limit(RECENT_POST_LIMIT);

    return rows.map((r) => ({
      externalPostId: r.externalPostId,
      platform: r.platform,
      capturedAt: r.capturedAt,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
      raw: (r.raw as Record<string, unknown>) ?? {},
    }));
  }
}

/** Snapshot the computed signals as insight evidence (audit trail). */
function toEvidence(signals: OptimizationSignals): Record<string, unknown> {
  return {
    bestPostingHour: signals.bestPostingHour,
    topHashtags: signals.topHashtags,
    bestFormat: signals.bestFormat,
    sampleSize: signals.sampleSize,
  };
}
