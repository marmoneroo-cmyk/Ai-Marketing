import type {
  ConversionCounts,
  DailyKpis,
  KpiRowValues,
  PostMetricRow,
  TopPost,
} from './types';

/** Coerce a nullable metric into a finite non-negative number (nulls → 0). */
function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Engagement for a single post = likes + comments + shares (nulls treated as 0). */
export function postEngagement(row: Pick<PostMetricRow, 'likes' | 'comments' | 'shares'>): number {
  return num(row.likes) + num(row.comments) + num(row.shares);
}

/**
 * Sum a day's raw post metrics into totals. Empty input yields all-zero totals;
 * null fields never propagate as NaN.
 */
export function sumPostMetrics(rows: readonly PostMetricRow[]): {
  reach: number;
  impressions: number;
  engagement: number;
  clicks: number;
} {
  let reach = 0;
  let impressions = 0;
  let engagement = 0;
  let clicks = 0;

  for (const row of rows) {
    reach += num(row.reach);
    impressions += num(row.impressions);
    engagement += postEngagement(row);
    clicks += num(row.clicks);
  }

  return { reach, impressions, engagement, clicks };
}

/**
 * Click-through rate = clicks / impressions. Returns null when impressions is 0
 * to avoid a divide-by-zero (the column is nullable).
 */
export function computeCtr(clicks: number, impressions: number): number | null {
  if (impressions <= 0) return null;
  return clicks / impressions;
}

/**
 * Conversion rate = sales / leads. Returns null when there were no leads, so an
 * empty denominator is stored as NULL rather than 0 or Infinity.
 */
export function computeConversionRate(sales: number, leads: number): number | null {
  if (leads <= 0) return null;
  return sales / leads;
}

/**
 * Combine summed post metrics with the day's conversion counts into the full set
 * of daily KPIs, computing rate fields with guarded denominators.
 */
export function computeDailyKpis(
  rows: readonly PostMetricRow[],
  conversions: ConversionCounts,
): DailyKpis {
  const totals = sumPostMetrics(rows);
  return {
    reach: totals.reach,
    impressions: totals.impressions,
    engagement: totals.engagement,
    clicks: totals.clicks,
    leads: conversions.leads,
    appointments: conversions.appointments,
    sales: conversions.sales,
    revenue: conversions.revenue,
    ctr: computeCtr(totals.clicks, totals.impressions),
    conversionRate: computeConversionRate(conversions.sales, conversions.leads),
  };
}

/**
 * Convert computed KPIs into the persistence shape: `numeric` columns become
 * strings (drizzle requirement), null rates stay null (conditional, so
 * exactOptionalPropertyTypes is satisfied without writing `undefined`).
 */
export function toKpiRow(kpis: DailyKpis): KpiRowValues {
  return {
    reach: kpis.reach,
    impressions: kpis.impressions,
    engagement: kpis.engagement,
    clicks: kpis.clicks,
    leads: kpis.leads,
    appointments: kpis.appointments,
    sales: kpis.sales,
    revenue: kpis.revenue.toFixed(2),
    ctr: kpis.ctr === null ? null : kpis.ctr.toFixed(6),
    conversionRate: kpis.conversionRate === null ? null : kpis.conversionRate.toFixed(6),
  };
}

/**
 * Rank posts by engagement descending and take the top `limit`. Pure and stable:
 * does not mutate the input array. `limit <= 0` yields an empty list.
 */
export function rankTopPosts(
  posts: readonly TopPost[],
  limit: number,
): TopPost[] {
  if (limit <= 0) return [];
  return [...posts].sort((a, b) => b.engagement - a.engagement).slice(0, limit);
}
