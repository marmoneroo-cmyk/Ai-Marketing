import { describe, it, expect } from 'vitest';
import {
  computeConversionRate,
  computeCtr,
  computeDailyKpis,
  postEngagement,
  rankTopPosts,
  sumPostMetrics,
  toKpiRow,
} from './metrics-math';
import type { ConversionCounts, PostMetricRow } from './types';

const row = (over: Partial<PostMetricRow> = {}): PostMetricRow => ({
  reach: 0,
  impressions: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  clicks: 0,
  ...over,
});

const noConversions: ConversionCounts = { leads: 0, appointments: 0, sales: 0, revenue: 0 };

describe('postEngagement', () => {
  it('sums likes, comments and shares', () => {
    expect(postEngagement({ likes: 3, comments: 2, shares: 5 })).toBe(10);
  });

  it('treats null fields as zero', () => {
    expect(postEngagement({ likes: null, comments: 4, shares: null })).toBe(4);
  });
});

describe('sumPostMetrics', () => {
  it('returns all-zero totals for empty input', () => {
    expect(sumPostMetrics([])).toEqual({ reach: 0, impressions: 0, engagement: 0, clicks: 0 });
  });

  it('aggregates reach, impressions, engagement and clicks across rows', () => {
    const totals = sumPostMetrics([
      row({ reach: 100, impressions: 200, likes: 1, comments: 2, shares: 3, clicks: 4 }),
      row({ reach: 50, impressions: 25, likes: 10, comments: 0, shares: 0, clicks: 1 }),
    ]);
    expect(totals).toEqual({ reach: 150, impressions: 225, engagement: 16, clicks: 5 });
  });

  it('does not propagate nulls as NaN', () => {
    const totals = sumPostMetrics([row({ reach: null, impressions: null, clicks: null })]);
    expect(totals.reach).toBe(0);
    expect(totals.impressions).toBe(0);
    expect(totals.clicks).toBe(0);
    expect(Number.isNaN(totals.engagement)).toBe(false);
  });
});

describe('computeCtr', () => {
  it('returns clicks / impressions when impressions > 0', () => {
    expect(computeCtr(5, 100)).toBe(0.05);
  });

  it('returns null when impressions is zero (no divide-by-zero)', () => {
    expect(computeCtr(5, 0)).toBeNull();
  });

  it('returns null for negative impressions', () => {
    expect(computeCtr(1, -10)).toBeNull();
  });
});

describe('computeConversionRate', () => {
  it('returns sales / leads when leads > 0', () => {
    expect(computeConversionRate(3, 12)).toBe(0.25);
  });

  it('returns null when there are no leads', () => {
    expect(computeConversionRate(0, 0)).toBeNull();
  });
});

describe('computeDailyKpis', () => {
  it('produces null rate fields when denominators are zero and input is empty', () => {
    const kpis = computeDailyKpis([], noConversions);
    expect(kpis.reach).toBe(0);
    expect(kpis.ctr).toBeNull();
    expect(kpis.conversionRate).toBeNull();
  });

  it('computes engagement and both rates from metrics + conversions', () => {
    const kpis = computeDailyKpis(
      [row({ impressions: 1000, likes: 5, comments: 3, shares: 2, clicks: 50 })],
      { leads: 10, appointments: 4, sales: 2, revenue: 199.9 },
    );
    expect(kpis.engagement).toBe(10);
    expect(kpis.clicks).toBe(50);
    expect(kpis.ctr).toBeCloseTo(0.05, 10);
    expect(kpis.conversionRate).toBeCloseTo(0.2, 10);
    expect(kpis.revenue).toBe(199.9);
  });
});

describe('toKpiRow', () => {
  it('stringifies numeric columns and keeps null rates null', () => {
    const rowValues = toKpiRow(computeDailyKpis([], noConversions));
    expect(rowValues.revenue).toBe('0.00');
    expect(rowValues.ctr).toBeNull();
    expect(rowValues.conversionRate).toBeNull();
    expect(rowValues.reach).toBe(0);
  });

  it('formats revenue to 2dp and rates to 6dp strings', () => {
    const rowValues = toKpiRow(
      computeDailyKpis(
        [row({ impressions: 4, clicks: 1 })],
        { leads: 4, appointments: 0, sales: 1, revenue: 12.5 },
      ),
    );
    expect(rowValues.revenue).toBe('12.50');
    expect(rowValues.ctr).toBe('0.250000');
    expect(rowValues.conversionRate).toBe('0.250000');
  });
});

describe('rankTopPosts', () => {
  it('returns empty for empty input or non-positive limit', () => {
    expect(rankTopPosts([], 5)).toEqual([]);
    expect(rankTopPosts([{ externalPostId: 'a', engagement: 9 }], 0)).toEqual([]);
  });

  it('ranks by engagement descending and respects the limit', () => {
    const ranked = rankTopPosts(
      [
        { externalPostId: 'low', engagement: 1 },
        { externalPostId: 'high', engagement: 99 },
        { externalPostId: 'mid', engagement: 50 },
      ],
      2,
    );
    expect(ranked.map((p) => p.externalPostId)).toEqual(['high', 'mid']);
  });

  it('does not mutate the input array', () => {
    const input = [
      { externalPostId: 'a', engagement: 1 },
      { externalPostId: 'b', engagement: 2 },
    ];
    rankTopPosts(input, 5);
    expect(input.map((p) => p.externalPostId)).toEqual(['a', 'b']);
  });
});
