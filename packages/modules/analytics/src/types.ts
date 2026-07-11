/** A single post's engagement roll-up, ranked by `topPosts`. */
export interface TopPost {
  externalPostId: string | null;
  engagement: number;
}

/** Raw per-post metric row fields consumed by the aggregation helpers. */
export interface PostMetricRow {
  reach: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
}

/** Conversion counts (and revenue) derived from the day's signals. */
export interface ConversionCounts {
  leads: number;
  appointments: number;
  sales: number;
  revenue: number;
}

/**
 * Fully-aggregated KPI figures for one org-day, ready to be written to
 * `kpi_daily`. Numeric columns are emitted as strings by `toKpiRow`.
 */
export interface DailyKpis {
  reach: number;
  impressions: number;
  engagement: number;
  clicks: number;
  leads: number;
  appointments: number;
  sales: number;
  revenue: number;
  /** clicks / impressions, or null when impressions === 0. */
  ctr: number | null;
  /** sales / leads, or null when leads === 0. */
  conversionRate: number | null;
}

/** String-valued shape written to the `kpi_daily` numeric/string columns. */
export interface KpiRowValues {
  reach: number;
  impressions: number;
  engagement: number;
  clicks: number;
  leads: number;
  appointments: number;
  sales: number;
  revenue: string;
  ctr: string | null;
  conversionRate: string | null;
}
