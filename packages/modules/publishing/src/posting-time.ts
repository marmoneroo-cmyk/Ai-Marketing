import type { HourEngagement } from './types';

/** UTC hours in a day. */
const HOURS_IN_DAY = 24;
/** Fallback posting hour (noon UTC) when there is no engagement history. */
export const DEFAULT_POSTING_HOUR = 12;

/** One raw metric row's engagement inputs; nulls are treated as zero. */
export interface MetricSample {
  capturedAt: Date;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

/** Total engagement for a single metric row (likes + comments + shares). */
export function engagementOf(sample: Readonly<MetricSample>): number {
  return (sample.likes ?? 0) + (sample.comments ?? 0) + (sample.shares ?? 0);
}

/**
 * Group metric samples by their UTC capture hour and average engagement within
 * each hour. Deterministic and side-effect free; ascending by hour.
 */
export function averageEngagementByHour(
  samples: readonly MetricSample[],
): HourEngagement[] {
  const totals = new Array<number>(HOURS_IN_DAY).fill(0);
  const counts = new Array<number>(HOURS_IN_DAY).fill(0);

  for (const sample of samples) {
    const hour = sample.capturedAt.getUTCHours();
    if (hour < 0 || hour >= HOURS_IN_DAY) continue;
    totals[hour] = (totals[hour] ?? 0) + engagementOf(sample);
    counts[hour] = (counts[hour] ?? 0) + 1;
  }

  const result: HourEngagement[] = [];
  for (let hour = 0; hour < HOURS_IN_DAY; hour++) {
    const count = counts[hour] ?? 0;
    if (count === 0) continue;
    result.push({ hour, avgEngagement: (totals[hour] ?? 0) / count });
  }
  return result;
}

/**
 * Pick the UTC hour (0–23) with the highest average engagement. Ties resolve to
 * the earliest hour for determinism. Returns {@link DEFAULT_POSTING_HOUR} when
 * there is no data.
 */
export function rankBestHour(samples: readonly MetricSample[]): number {
  const ranked = averageEngagementByHour(samples);
  if (ranked.length === 0) return DEFAULT_POSTING_HOUR;

  let best = ranked[0] as HourEngagement;
  for (const candidate of ranked) {
    if (candidate.avgEngagement > best.avgEngagement) best = candidate;
  }
  return best.hour;
}
