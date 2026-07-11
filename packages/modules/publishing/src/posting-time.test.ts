import { describe, it, expect } from 'vitest';
import {
  averageEngagementByHour,
  engagementOf,
  rankBestHour,
  DEFAULT_POSTING_HOUR,
  type MetricSample,
} from './posting-time';

/** Build a sample captured at a fixed UTC hour on an arbitrary day. */
function sampleAt(hour: number, likes: number, comments: number, shares: number): MetricSample {
  return {
    capturedAt: new Date(Date.UTC(2026, 0, 1, hour, 0, 0)),
    likes,
    comments,
    shares,
  };
}

describe('engagementOf', () => {
  it('sums likes, comments, and shares', () => {
    // Arrange
    const sample = sampleAt(9, 3, 4, 5);

    // Act
    const total = engagementOf(sample);

    // Assert
    expect(total).toBe(12);
  });

  it('treats null metrics as zero', () => {
    // Arrange
    const sample: MetricSample = { capturedAt: new Date(), likes: null, comments: 2, shares: null };

    // Act & Assert
    expect(engagementOf(sample)).toBe(2);
  });
});

describe('averageEngagementByHour', () => {
  it('averages engagement within each UTC hour and omits empty hours', () => {
    // Arrange
    const samples = [sampleAt(9, 10, 0, 0), sampleAt(9, 20, 0, 0), sampleAt(18, 1, 1, 1)];

    // Act
    const ranked = averageEngagementByHour(samples);

    // Assert
    expect(ranked).toEqual([
      { hour: 9, avgEngagement: 15 },
      { hour: 18, avgEngagement: 3 },
    ]);
  });

  it('returns an empty array when there are no samples', () => {
    expect(averageEngagementByHour([])).toEqual([]);
  });
});

describe('rankBestHour', () => {
  it('returns the UTC hour with the highest average engagement', () => {
    // Arrange
    const samples = [sampleAt(8, 1, 0, 0), sampleAt(20, 50, 5, 5), sampleAt(20, 40, 5, 5)];

    // Act
    const hour = rankBestHour(samples);

    // Assert
    expect(hour).toBe(20);
  });

  it('breaks ties toward the earliest hour', () => {
    // Arrange
    const samples = [sampleAt(6, 10, 0, 0), sampleAt(14, 10, 0, 0)];

    // Act & Assert
    expect(rankBestHour(samples)).toBe(6);
  });

  it('falls back to the default hour with no data', () => {
    expect(rankBestHour([])).toBe(DEFAULT_POSTING_HOUR);
  });
});
