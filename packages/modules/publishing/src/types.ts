/** Public input/result shapes for the Publishing Engine. */

/** Request to schedule one per-platform post from an approved content variant. */
export interface SchedulePostInput {
  contentVariantId: string;
  socialAccountId: string;
  scheduledFor: Date;
  /** When true, the post must be `approve`d before it may be published. */
  approvalRequired?: boolean;
}

export interface ScheduleResult {
  scheduledPostId: string;
}

/** Outcome of attempting to publish one scheduled post through a connector. */
export interface ProcessResult {
  status: 'published' | 'failed';
  externalPostId?: string;
}

/**
 * One (hour, averageEngagement) sample used to rank posting times. `hour` is a
 * UTC hour in 0–23; `avgEngagement` is the mean of (likes + comments + shares).
 */
export interface HourEngagement {
  hour: number;
  avgEngagement: number;
}
