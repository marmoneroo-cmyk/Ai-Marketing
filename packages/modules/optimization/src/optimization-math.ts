import { asString, clamp, extractJsonSlice } from '@brandpilot/agent-runtime';
import type {
  OptimizationMetricRow,
  OptimizationSignals,
  Recommendation,
} from './types';

const MAX_TOP_HASHTAGS = 5;
const HOURS_IN_DAY = 24;

/** Coerce a nullable metric into a finite non-negative number (nulls → 0). */
function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Engagement for a single row = likes + comments + shares. */
function engagementOf(row: OptimizationMetricRow): number {
  return num(row.likes) + num(row.comments) + num(row.shares);
}

/** Mean of a non-empty list of numbers; 0 for an empty list. */
function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Pick the key whose values have the highest mean. Ties resolve to the key with
 * the larger sample, then lexicographically, for deterministic output. Returns
 * null when the map is empty.
 */
function argmaxByMean<K extends string | number>(groups: Map<K, number[]>): K | null {
  let best: K | null = null;
  let bestMean = -Infinity;
  let bestCount = 0;

  for (const [key, values] of groups) {
    const m = mean(values);
    const count = values.length;
    const better =
      m > bestMean ||
      (m === bestMean && count > bestCount) ||
      (m === bestMean && count === bestCount && best !== null && String(key) < String(best));
    if (better) {
      best = key;
      bestMean = m;
      bestCount = count;
    }
  }

  return best;
}

/** Extract the UTC hour (0–23) from a row's capture time; null if invalid. */
function hourOf(row: OptimizationMetricRow): number | null {
  const h = row.capturedAt instanceof Date ? row.capturedAt.getUTCHours() : NaN;
  return Number.isInteger(h) && h >= 0 && h < HOURS_IN_DAY ? h : null;
}

/** Read hashtags from a row's `raw` payload (array or space/comma string). */
export function extractHashtags(raw: Record<string, unknown>): string[] {
  const value = raw.hashtags ?? raw.tags;
  const out: string[] = [];
  if (Array.isArray(value)) {
    for (const v of value) if (typeof v === 'string' && v.trim()) out.push(normalizeHashtag(v));
  } else if (typeof value === 'string') {
    for (const part of value.split(/[\s,]+/)) if (part.trim()) out.push(normalizeHashtag(part));
  }
  return out;
}

function normalizeHashtag(tag: string): string {
  const trimmed = tag.trim().toLowerCase();
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

/** Read a content format label from a row's `raw` payload; null if absent. */
export function extractFormat(raw: Record<string, unknown>): string | null {
  const value = raw.format ?? raw.media_type ?? raw.mediaType ?? raw.type;
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

/** Hour (0–23) with the highest average engagement across rows, or null. */
export function bestPostingHour(rows: readonly OptimizationMetricRow[]): number | null {
  const groups = new Map<number, number[]>();
  for (const row of rows) {
    const hour = hourOf(row);
    if (hour === null) continue;
    const bucket = groups.get(hour) ?? [];
    bucket.push(engagementOf(row));
    groups.set(hour, bucket);
  }
  return argmaxByMean(groups);
}

/** Hashtags ranked by total associated engagement, highest first. */
export function topHashtags(
  rows: readonly OptimizationMetricRow[],
  limit: number = MAX_TOP_HASHTAGS,
): string[] {
  if (limit <= 0) return [];
  const totals = new Map<string, number>();
  for (const row of rows) {
    const engagement = engagementOf(row);
    for (const tag of extractHashtags(row.raw)) {
      totals.set(tag, (totals.get(tag) ?? 0) + engagement);
    }
  }
  return [...totals.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, limit)
    .map(([tag]) => tag);
}

/** Content format with the highest average engagement, or null. */
export function bestFormat(rows: readonly OptimizationMetricRow[]): string | null {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const format = extractFormat(row.raw);
    if (format === null) continue;
    const bucket = groups.get(format) ?? [];
    bucket.push(engagementOf(row));
    groups.set(format, bucket);
  }
  return argmaxByMean(groups);
}

/** Compute all deterministic optimization signals from recent post metrics. */
export function computeSignals(rows: readonly OptimizationMetricRow[]): OptimizationSignals {
  return {
    bestPostingHour: bestPostingHour(rows),
    topHashtags: topHashtags(rows),
    bestFormat: bestFormat(rows),
    sampleSize: rows.length,
  };
}

/**
 * Build the reasoning-tier prompt. The model must ground every recommendation in
 * the pre-computed FACTS block and return a strict JSON envelope.
 */
export function buildRecommendationPrompt(signals: OptimizationSignals): string {
  const facts = [
    `sample_size: ${signals.sampleSize}`,
    `best_posting_hour_utc: ${signals.bestPostingHour ?? 'unknown'}`,
    `best_format: ${signals.bestFormat ?? 'unknown'}`,
    `top_hashtags: ${signals.topHashtags.length > 0 ? signals.topHashtags.join(', ') : 'none'}`,
  ].join('\n');

  return [
    'You are optimizing a small business\'s social media performance.',
    'Below are FACTS computed deterministically from the account\'s recent post metrics.',
    'Produce concrete, actionable recommendations that are ENTIRELY grounded in these FACTS.',
    'Do NOT invent numbers, hours, formats, or hashtags that are not present in the FACTS.',
    'Put a STRINGIFIED JSON object in your "output" with this shape:',
    '{ "recommendations": [{ "title": string, "body": string, "confidence": number }] }  // confidence in [0,1]',
    'If the FACTS are too sparse to justify a recommendation, return an empty array.',
    '--- FACTS ---',
    facts,
  ].join('\n\n');
}

/** Clamp a value into the confidence range [0,1]; non-numbers default to 0.5. */
export function clampConfidence(value: unknown): number {
  return clamp(value, 0, 1, 0.5);
}

/**
 * Parse the model's recommendations output defensively; never throws. Accepts
 * either a raw array or a `{ recommendations: [...] }` envelope, and drops any
 * entry without a usable title.
 */
export function parseRecommendations(output: string): Recommendation[] {
  try {
    const parsed: unknown = JSON.parse(extractJsonSlice(output, { preferArray: true }));

    const list: unknown = Array.isArray(parsed)
      ? parsed
      : (parsed as { recommendations?: unknown }).recommendations;
    if (!Array.isArray(list)) return [];

    const recs: Recommendation[] = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const title = asString(rec.title).trim();
      if (!title) continue;
      recs.push({
        title,
        body: asString(rec.body),
        confidence: clampConfidence(rec.confidence),
      });
    }
    return recs;
  } catch {
    return [];
  }
}
