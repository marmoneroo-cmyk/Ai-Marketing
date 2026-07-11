import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '@brandpilot/db';
import { kpiDaily, postMetrics, signals } from '@brandpilot/db';
import type { ConversionCounts, PostMetricRow, TopPost } from './types';
import { computeDailyKpis, postEngagement, rankTopPosts, toKpiRow } from './metrics-math';

const DEFAULT_TOP_POSTS = 5;

export interface AnalyticsDeps {
  db: Database;
}

/**
 * Module — analytics roll-up. Aggregates raw per-post metric snapshots and the
 * day's conversion signals into a single `kpi_daily` row per org-day, and ranks
 * top-performing posts. All heavy math lives in `metrics-math.ts`; this class only
 * loads rows, delegates, and persists. Everything is org-scoped.
 */
export class AnalyticsEngine {
  private readonly db: Database;

  constructor(deps: AnalyticsDeps) {
    this.db = deps.db;
  }

  /**
   * Aggregate one calendar day of post metrics + conversion signals and upsert the
   * matching `kpi_daily` row (composite PK `(orgId, day)`).
   */
  async rollupDaily(orgId: string, day: Date): Promise<void> {
    const { start, end } = dayBounds(day);
    const dayString = toDateString(day);

    const [metricRows, conversions] = await Promise.all([
      this.loadPostMetrics(orgId, start, end),
      this.countConversions(orgId, start, end),
    ]);

    const kpis = computeDailyKpis(metricRows, conversions);
    const values = toKpiRow(kpis);

    await this.db
      .insert(kpiDaily)
      .values({ orgId, day: dayString, ...values })
      .onConflictDoUpdate({
        target: [kpiDaily.orgId, kpiDaily.day],
        set: values,
      });
  }

  /**
   * Rank an org's posts by engagement (likes + comments + shares) descending.
   */
  async topPosts(orgId: string, limit: number = DEFAULT_TOP_POSTS): Promise<TopPost[]> {
    // Rank + cap at the DB so a growing post_metrics table never loads wholesale
    // into memory (was an unbounded per-org scan). engagement = likes+comments+shares.
    const engagement = sql<number>`coalesce(${postMetrics.likes}, 0) + coalesce(${postMetrics.comments}, 0) + coalesce(${postMetrics.shares}, 0)`;
    const rows = await this.db
      .select({
        externalPostId: postMetrics.externalPostId,
        likes: postMetrics.likes,
        comments: postMetrics.comments,
        shares: postMetrics.shares,
      })
      .from(postMetrics)
      .where(eq(postMetrics.orgId, orgId))
      .orderBy(desc(engagement))
      .limit(Math.max(0, limit));

    const ranked: TopPost[] = rows.map((r) => ({
      externalPostId: r.externalPostId,
      engagement: postEngagement(r),
    }));

    return rankTopPosts(ranked, limit);
  }

  private async loadPostMetrics(orgId: string, start: Date, end: Date): Promise<PostMetricRow[]> {
    return this.db
      .select({
        reach: postMetrics.reach,
        impressions: postMetrics.impressions,
        likes: postMetrics.likes,
        comments: postMetrics.comments,
        shares: postMetrics.shares,
        clicks: postMetrics.clicks,
      })
      .from(postMetrics)
      .where(
        and(
          eq(postMetrics.orgId, orgId),
          gte(postMetrics.capturedAt, start),
          lt(postMetrics.capturedAt, end),
        ),
      );
  }

  private async countConversions(orgId: string, start: Date, end: Date): Promise<ConversionCounts> {
    const rows = await this.db
      .select({ type: signals.type, value: signals.value })
      .from(signals)
      .where(
        and(
          eq(signals.orgId, orgId),
          inArray(signals.type, ['lead_created', 'appointment_booked', 'sale']),
          gte(signals.occurredAt, start),
          lt(signals.occurredAt, end),
        ),
      );

    const counts: ConversionCounts = { leads: 0, appointments: 0, sales: 0, revenue: 0 };
    for (const r of rows) {
      if (r.type === 'lead_created') counts.leads += 1;
      else if (r.type === 'appointment_booked') counts.appointments += 1;
      else if (r.type === 'sale') {
        counts.sales += 1;
        counts.revenue += parseValue(r.value);
      }
    }
    return counts;
  }
}

/** `numeric` columns arrive as strings; parse to a finite number (else 0). */
function parseValue(value: string | null): number {
  if (value === null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** UTC [start, end) bounds for the calendar day containing `day`. */
function dayBounds(day: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

/** Format a Date as a `YYYY-MM-DD` string for drizzle `date` columns. */
function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
