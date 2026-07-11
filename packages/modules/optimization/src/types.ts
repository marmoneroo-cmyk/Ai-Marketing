/** A post metric row as consumed by the optimization signal computation. */
export interface OptimizationMetricRow {
  externalPostId: string | null;
  platform: string;
  capturedAt: Date;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  raw: Record<string, unknown>;
}

/** A KPI daily row as consumed by trend computation. */
export interface OptimizationKpiRow {
  day: string;
  engagement: number | null;
  ctr: string | null;
  conversionRate: string | null;
}

/**
 * Deterministic, evidence-backed signals computed from an org's recent metrics.
 * These are the ONLY facts the model is allowed to turn into recommendations.
 */
export interface OptimizationSignals {
  /** Hour of day (0–23, UTC) with the highest average engagement, or null. */
  bestPostingHour: number | null;
  /** Hashtags ranked by total associated engagement (highest first). */
  topHashtags: string[];
  /** Content format (from `raw.format`/`raw.media_type`) with best avg engagement, or null. */
  bestFormat: string | null;
  /** Number of post rows the signals were computed from. */
  sampleSize: number;
}

/** A single recommendation as parsed from the model's JSON output. */
export interface Recommendation {
  title: string;
  body: string;
  /** Confidence in [0,1]. */
  confidence: number;
}

/** Result of `OptimizationEngine.analyze`. */
export interface AnalyzeResult {
  recommendations: number;
}
