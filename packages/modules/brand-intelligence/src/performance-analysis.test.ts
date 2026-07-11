import { describe, expect, test } from 'vitest';
import {
  engagementScore,
  rankByEngagement,
  patternConfidence,
  type PostEngagement,
} from './performance-analysis';

const post = (over: Partial<PostEngagement>): PostEngagement => ({
  externalPostId: null,
  platform: 'instagram',
  likes: null,
  comments: null,
  shares: null,
  ...over,
});

describe('engagementScore', () => {
  test('sums likes, comments, and shares', () => {
    expect(engagementScore(post({ likes: 10, comments: 3, shares: 2 }))).toBe(15);
  });

  test('treats null and negative counts as zero', () => {
    expect(engagementScore(post({ likes: null, comments: -5, shares: 4 }))).toBe(4);
  });
});

describe('rankByEngagement', () => {
  test('orders posts by engagement descending', () => {
    // Arrange
    const posts = [
      post({ externalPostId: 'low', likes: 1 }),
      post({ externalPostId: 'high', likes: 100 }),
      post({ externalPostId: 'mid', likes: 50 }),
    ];

    // Act
    const ranked = rankByEngagement(posts);

    // Assert
    expect(ranked.map((r) => r.externalPostId)).toEqual(['high', 'mid', 'low']);
  });

  test('breaks ties deterministically by platform then id', () => {
    // Arrange
    const posts = [
      post({ externalPostId: 'b', platform: 'tiktok', likes: 5 }),
      post({ externalPostId: 'a', platform: 'instagram', likes: 5 }),
      post({ externalPostId: 'c', platform: 'instagram', likes: 5 }),
    ];

    // Act
    const ranked = rankByEngagement(posts);

    // Assert — instagram before tiktok; within instagram, id a before c
    expect(ranked.map((r) => `${r.platform}:${r.externalPostId}`)).toEqual([
      'instagram:a',
      'instagram:c',
      'tiktok:b',
    ]);
  });

  test('returns an empty array for no posts', () => {
    expect(rankByEngagement([])).toEqual([]);
  });
});

describe('patternConfidence', () => {
  test('scales with sample size and saturates at 20', () => {
    expect(patternConfidence(0)).toBe('0.000');
    expect(patternConfidence(10)).toBe('0.500');
    expect(patternConfidence(20)).toBe('1.000');
    expect(patternConfidence(50)).toBe('1.000');
  });
});
