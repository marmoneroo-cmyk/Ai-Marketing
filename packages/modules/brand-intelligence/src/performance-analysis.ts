/** A post's engagement metrics as read from `post_metrics`. */
export interface PostEngagement {
  externalPostId: string | null;
  platform: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

/** A post scored and ready to become an insight. */
export interface RankedPost {
  externalPostId: string | null;
  platform: string;
  engagement: number;
}

const toCount = (v: number | null): number => (typeof v === 'number' && v > 0 ? v : 0);

/** Deterministic engagement score = likes + comments + shares. Pure. */
export function engagementScore(post: PostEngagement): number {
  return toCount(post.likes) + toCount(post.comments) + toCount(post.shares);
}

/**
 * Rank posts by engagement, descending. Deterministic: ties break by platform
 * then externalPostId so the ordering is stable across runs.
 */
export function rankByEngagement(posts: readonly PostEngagement[]): RankedPost[] {
  return posts
    .map((p) => ({ externalPostId: p.externalPostId, platform: p.platform, engagement: engagementScore(p) }))
    .sort((a, b) => {
      if (b.engagement !== a.engagement) return b.engagement - a.engagement;
      if (a.platform !== b.platform) return a.platform < b.platform ? -1 : 1;
      const aId = a.externalPostId ?? '';
      const bId = b.externalPostId ?? '';
      return aId < bId ? -1 : aId > bId ? 1 : 0;
    });
}

/** Confidence for a best/worst pattern insight, scaled by sample size (max at 20 posts). */
export function patternConfidence(sampleSize: number): string {
  const MAX_SAMPLE = 20;
  const bounded = Math.max(0, Math.min(sampleSize, MAX_SAMPLE));
  return (bounded / MAX_SAMPLE).toFixed(3);
}
