import { describe, it, expect } from 'vitest';
import {
  bestFormat,
  bestPostingHour,
  buildRecommendationPrompt,
  clampConfidence,
  computeSignals,
  extractFormat,
  extractHashtags,
  parseRecommendations,
  topHashtags,
} from './optimization-math';
import type { OptimizationMetricRow } from './types';

const at = (hourUtc: number): Date => new Date(Date.UTC(2026, 0, 1, hourUtc, 0, 0));

const row = (over: Partial<OptimizationMetricRow> = {}): OptimizationMetricRow => ({
  externalPostId: null,
  platform: 'instagram',
  capturedAt: at(12),
  likes: 0,
  comments: 0,
  shares: 0,
  raw: {},
  ...over,
});

describe('extractHashtags', () => {
  it('reads an array and normalizes to lowercase with leading #', () => {
    expect(extractHashtags({ hashtags: ['Foo', '#Bar'] })).toEqual(['#foo', '#bar']);
  });

  it('splits a space/comma-delimited string and ignores empties', () => {
    expect(extractHashtags({ tags: '#a, b   c' })).toEqual(['#a', '#b', '#c']);
  });

  it('returns empty when absent or wrong type', () => {
    expect(extractHashtags({})).toEqual([]);
    expect(extractHashtags({ hashtags: 42 })).toEqual([]);
  });
});

describe('extractFormat', () => {
  it('reads format/media_type/type in priority order, lowercased', () => {
    expect(extractFormat({ format: 'Reel' })).toBe('reel');
    expect(extractFormat({ media_type: 'CAROUSEL' })).toBe('carousel');
    expect(extractFormat({ type: 'image' })).toBe('image');
  });

  it('returns null when absent', () => {
    expect(extractFormat({})).toBeNull();
  });
});

describe('bestPostingHour', () => {
  it('returns null for empty input', () => {
    expect(bestPostingHour([])).toBeNull();
  });

  it('picks the UTC hour with the highest average engagement', () => {
    const rows = [
      row({ capturedAt: at(9), likes: 1 }),
      row({ capturedAt: at(18), likes: 40, comments: 10 }),
      row({ capturedAt: at(18), likes: 30, comments: 10 }),
    ];
    expect(bestPostingHour(rows)).toBe(18);
  });

  it('ignores rows with an invalid capture date', () => {
    const rows = [
      row({ capturedAt: new Date('not-a-date'), likes: 999 }),
      row({ capturedAt: at(7), likes: 5 }),
    ];
    expect(bestPostingHour(rows)).toBe(7);
  });
});

describe('topHashtags', () => {
  it('ranks by total associated engagement, highest first', () => {
    const rows = [
      row({ likes: 10, raw: { hashtags: ['#sale'] } }),
      row({ likes: 5, raw: { hashtags: ['#sale', '#new'] } }),
      row({ likes: 1, raw: { hashtags: ['#new'] } }),
    ];
    expect(topHashtags(rows)).toEqual(['#sale', '#new']);
  });

  it('returns empty for no hashtags or non-positive limit', () => {
    expect(topHashtags([row()])).toEqual([]);
    expect(topHashtags([row({ raw: { hashtags: ['#x'] } })], 0)).toEqual([]);
  });
});

describe('bestFormat', () => {
  it('returns the format with the best average engagement', () => {
    const rows = [
      row({ likes: 100, raw: { format: 'reel' } }),
      row({ likes: 2, raw: { format: 'image' } }),
      row({ likes: 4, raw: { format: 'image' } }),
    ];
    expect(bestFormat(rows)).toBe('reel');
  });

  it('returns null when no row carries a format', () => {
    expect(bestFormat([row()])).toBeNull();
  });
});

describe('computeSignals', () => {
  it('reports sampleSize and null signals for empty/sparse input', () => {
    const signals = computeSignals([]);
    expect(signals).toEqual({
      bestPostingHour: null,
      topHashtags: [],
      bestFormat: null,
      sampleSize: 0,
    });
  });

  it('aggregates every signal from a mixed sample', () => {
    const rows = [
      row({ capturedAt: at(20), likes: 50, raw: { format: 'reel', hashtags: ['#promo'] } }),
      row({ capturedAt: at(20), likes: 30, raw: { format: 'reel', hashtags: ['#promo'] } }),
      row({ capturedAt: at(8), likes: 1, raw: { format: 'image', hashtags: ['#daily'] } }),
    ];
    const signals = computeSignals(rows);
    expect(signals.bestPostingHour).toBe(20);
    expect(signals.bestFormat).toBe('reel');
    expect(signals.topHashtags[0]).toBe('#promo');
    expect(signals.sampleSize).toBe(3);
  });
});

describe('clampConfidence', () => {
  it('clamps into [0,1] and defaults non-numbers to 0.5', () => {
    expect(clampConfidence(1.7)).toBe(1);
    expect(clampConfidence(-2)).toBe(0);
    expect(clampConfidence(0.42)).toBe(0.42);
    expect(clampConfidence('high')).toBe(0.5);
  });
});

describe('parseRecommendations', () => {
  it('returns empty for non-JSON output', () => {
    expect(parseRecommendations('the model refused')).toEqual([]);
  });

  it('parses a { recommendations: [...] } envelope embedded in prose', () => {
    const out = 'Sure: {"recommendations":[{"title":"Post at 20:00","body":"b","confidence":0.8}]} ok';
    const recs = parseRecommendations(out);
    expect(recs).toHaveLength(1);
    expect(recs[0]?.title).toBe('Post at 20:00');
    expect(recs[0]?.confidence).toBe(0.8);
  });

  it('accepts a bare array and drops entries without a title', () => {
    const out = '[{"title":"Keep it","confidence":2},{"body":"no title"}]';
    const recs = parseRecommendations(out);
    expect(recs).toHaveLength(1);
    expect(recs[0]?.title).toBe('Keep it');
    expect(recs[0]?.confidence).toBe(1);
    expect(recs[0]?.body).toBe('');
  });
});

describe('buildRecommendationPrompt', () => {
  it('embeds computed facts and instructs strict grounding', () => {
    const prompt = buildRecommendationPrompt({
      bestPostingHour: 18,
      topHashtags: ['#sale'],
      bestFormat: 'reel',
      sampleSize: 12,
    });
    expect(prompt).toContain('best_posting_hour_utc: 18');
    expect(prompt).toContain('best_format: reel');
    expect(prompt).toContain('#sale');
    expect(prompt).toContain('recommendations');
  });

  it('renders unknown/none for missing signals', () => {
    const prompt = buildRecommendationPrompt({
      bestPostingHour: null,
      topHashtags: [],
      bestFormat: null,
      sampleSize: 0,
    });
    expect(prompt).toContain('best_posting_hour_utc: unknown');
    expect(prompt).toContain('top_hashtags: none');
  });
});
