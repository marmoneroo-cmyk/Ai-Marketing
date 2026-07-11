import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '@brandpilot/db';
import { scheduledPosts, publishJobs, contentVariants, postMetrics } from '@brandpilot/db';
import type { BusinessBrain } from '@brandpilot/business-brain';
import type { Connector, PushAction, PushResult } from '@brandpilot/connectors';
import type { ProcessResult, ScheduleResult, SchedulePostInput } from './types';
import { rankBestHour, DEFAULT_POSTING_HOUR, type MetricSample } from './posting-time';

/** Provider-agnostic push kind used when publishing an organic post. */
const PUSH_KIND = 'post';
/** Max metric rows scanned when computing the best posting hour. */
const METRICS_SCAN_LIMIT = 1000;

export interface PublishingDeps {
  db: Database;
  brain: BusinessBrain;
}

/**
 * Module 4 — the scheduler and publisher. Turns approved content variants into
 * scheduled posts, drives each through its connector at publish time, and records
 * every attempt as a retryable `publishJobs` row. Publishing outcomes are emitted
 * to the Business Brain as `post_published` signals. Everything is org-scoped.
 *
 * The real Graph/API publish lives in the connector; this engine owns the
 * scheduling, status, and retry machinery and works unchanged once a connector's
 * `push` is implemented.
 */
export class PublishingEngine {
  private readonly deps: PublishingDeps;

  constructor(deps: PublishingDeps) {
    this.deps = deps;
  }

  /** Queue one approved variant for publication on a social account. */
  async schedulePost(orgId: string, input: SchedulePostInput): Promise<ScheduleResult> {
    const [row] = await this.deps.db
      .insert(scheduledPosts)
      .values({
        orgId,
        contentVariantId: input.contentVariantId,
        socialAccountId: input.socialAccountId,
        scheduledFor: input.scheduledFor,
        status: 'scheduled',
        ...(input.approvalRequired === undefined ? {} : { approvalRequired: input.approvalRequired }),
      })
      .returning();

    return { scheduledPostId: row?.id ?? '' };
  }

  /** Mark a scheduled post as human-approved so it becomes publishable. */
  async approve(orgId: string, scheduledPostId: string): Promise<void> {
    await this.deps.db
      .update(scheduledPosts)
      .set({ approvedAt: new Date() })
      .where(and(eq(scheduledPosts.id, scheduledPostId), eq(scheduledPosts.orgId, orgId)));
  }

  /**
   * Publish one scheduled post through its connector, recording a `publishJobs`
   * attempt either way. Never rethrows on a publish failure — the worker owns
   * retries and reads the recorded job/status to decide what to do next.
   */
  async processScheduledPost(
    orgId: string,
    scheduledPostId: string,
    connector: Connector,
    accessToken: string,
  ): Promise<ProcessResult> {
    const { db, brain } = this.deps;

    const [post] = await db
      .select()
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.id, scheduledPostId), eq(scheduledPosts.orgId, orgId)))
      .limit(1);
    if (!post) throw new Error(`Scheduled post ${scheduledPostId} not found`);

    // Idempotency guard: a publish is a NON-idempotent, at-least-once operation —
    // BullMQ retries, or a crash between the platform push and the status write,
    // must never double-post. A recorded `success` job (or an already-`published`
    // status) proves the post is live: reconcile the status and return WITHOUT
    // re-pushing. (The one irreducible window — a crash after `push` returns but
    // before the success row is written — needs a provider idempotency key.)
    const [priorSuccess] = await db
      .select({ externalPostId: publishJobs.externalPostId })
      .from(publishJobs)
      .where(
        and(eq(publishJobs.scheduledPostId, scheduledPostId), eq(publishJobs.status, 'success')),
      )
      .limit(1);
    if (priorSuccess || post.status === 'published') {
      if (post.status !== 'published') {
        await db
          .update(scheduledPosts)
          .set({ status: 'published' })
          .where(and(eq(scheduledPosts.id, scheduledPostId), eq(scheduledPosts.orgId, orgId)));
      }
      const priorExternalId = priorSuccess?.externalPostId;
      return { status: 'published', ...(priorExternalId ? { externalPostId: priorExternalId } : {}) };
    }

    const [variant] = await db
      .select()
      .from(contentVariants)
      .where(eq(contentVariants.id, post.contentVariantId))
      .limit(1);
    if (!variant) throw new Error(`Content variant ${post.contentVariantId} not found`);

    const attempt = await this.nextAttempt(scheduledPostId);
    const action = buildPushAction(variant, post.socialAccountId, accessToken);

    // Flip to `publishing` so the row reflects an in-flight attempt.
    await db
      .update(scheduledPosts)
      .set({ status: 'publishing' })
      .where(and(eq(scheduledPosts.id, scheduledPostId), eq(scheduledPosts.orgId, orgId)));

    // ONLY a platform push failure marks the post `failed`. Everything after a
    // successful push is post-publish bookkeeping that must NOT revert a live post
    // (the old code wrapped push + bookkeeping + signal in one try, so a signal or
    // DB blip flipped a published post back to `failed` and dropped its signal).
    let result: PushResult;
    try {
      result = await connector.push(action);
    } catch (err) {
      await db.insert(publishJobs).values({
        orgId,
        scheduledPostId,
        attempt,
        status: 'error',
        error: { message: errorMessage(err), attempt },
      });
      await db
        .update(scheduledPosts)
        .set({ status: 'failed' })
        .where(and(eq(scheduledPosts.id, scheduledPostId), eq(scheduledPosts.orgId, orgId)));
      return { status: 'failed' };
    }

    // Push succeeded → the post is LIVE. Record the success FIRST (so a retry's
    // idempotency guard above sees it), then mark published.
    const externalPostId = result.externalId;
    await db.insert(publishJobs).values({
      orgId,
      scheduledPostId,
      attempt,
      status: 'success',
      ...(externalPostId === undefined ? {} : { externalPostId }),
    });
    await db
      .update(scheduledPosts)
      .set({ status: 'published' })
      .where(and(eq(scheduledPosts.id, scheduledPostId), eq(scheduledPosts.orgId, orgId)));

    // The `post_published` signal is best-effort — a Brain blip must never revert
    // (or re-publish) a post that is already live.
    try {
      await brain.recordSignal(orgId, {
        type: 'post_published',
        subjectType: 'scheduled_post',
        subjectId: scheduledPostId,
        payload: {
          provider: connector.provider,
          socialAccountId: post.socialAccountId,
          attempt,
          ...(externalPostId === undefined ? {} : { externalPostId }),
        },
      });
    } catch {
      /* signal delivery failed; the post is published — do not revert or rethrow */
    }

    return { status: 'published', ...(externalPostId === undefined ? {} : { externalPostId }) };
  }

  /**
   * The UTC hour (0–23) with the highest average post engagement for this org,
   * defaulting to noon when there is no metric history.
   */
  async bestPostingHour(orgId: string): Promise<number> {
    const rows = await this.deps.db
      .select({
        capturedAt: postMetrics.capturedAt,
        likes: postMetrics.likes,
        comments: postMetrics.comments,
        shares: postMetrics.shares,
      })
      .from(postMetrics)
      .where(eq(postMetrics.orgId, orgId))
      // Most-recent-first so the scan window is the latest metrics (deterministic),
      // not an arbitrary physical-order slice for orgs with many historical rows.
      .orderBy(desc(postMetrics.capturedAt))
      .limit(METRICS_SCAN_LIMIT);

    if (rows.length === 0) return DEFAULT_POSTING_HOUR;

    const samples: MetricSample[] = rows.map((r) => ({
      capturedAt: r.capturedAt,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
    }));
    return rankBestHour(samples);
  }

  /** Next attempt number = count of prior jobs for this post + 1. */
  private async nextAttempt(scheduledPostId: string): Promise<number> {
    const prior = await this.deps.db
      .select({ id: publishJobs.id })
      .from(publishJobs)
      .where(eq(publishJobs.scheduledPostId, scheduledPostId));
    return prior.length + 1;
  }
}

/** Build a provider-agnostic publish action from a content variant. */
function buildPushAction(
  variant: { caption: string | null; hashtags: string[]; assetIds: string[] },
  accountId: string,
  accessToken: string,
): PushAction {
  return {
    kind: PUSH_KIND,
    accountId,
    accessToken,
    payload: {
      caption: variant.caption ?? '',
      hashtags: variant.hashtags,
      assetIds: variant.assetIds,
    },
  };
}

/** Narrow an unknown thrown value to a message string. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
