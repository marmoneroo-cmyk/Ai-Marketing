import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { and, eq } from 'drizzle-orm';
import { QUEUES, type PublishJobData } from '@brandpilot/core';
import { createConnector, decryptToken } from '@brandpilot/connectors';
import { scheduledPosts, socialAccounts, connectorTokens } from '@brandpilot/db';
import type { WorkerContext } from '../context';

/**
 * Publish a scheduled post: resolve the target account's provider, decrypt its
 * token, build the PROVIDER-SPECIFIC connector (a TikTok post cannot publish via
 * the Meta API), and hand off to the Publishing Engine (which records the attempt
 * + status and emits a `post_published` signal on success). No BullMQ-level job
 * retry is configured on this worker — transient failures in the outbound
 * provider call are instead absorbed at the HTTP layer by `resilientFetch`'s
 * per-attempt timeout + bounded retry/backoff (`@brandpilot/core`). All lookups
 * are org-scoped.
 */
export function createPublishWorker(ctx: WorkerContext, connection: IORedis): Worker<PublishJobData> {
  return new Worker<PublishJobData>(
    QUEUES.publish,
    async (job: Job<PublishJobData>) => {
      const { orgId, scheduledPostId } = job.data;

      const [post] = await ctx.db
        .select()
        .from(scheduledPosts)
        .where(and(eq(scheduledPosts.id, scheduledPostId), eq(scheduledPosts.orgId, orgId)))
        .limit(1);
      // A missing prerequisite must NOT resolve as a silent success. The scheduler
      // already flipped this post `scheduled → publishing`; returning a resolved
      // `{status:'failed'}` here fires BullMQ's `on('completed')` (logged at INFO),
      // so the post would be stranded in `publishing` forever with no error, no
      // Sentry, and no retry. Instead: mark it `failed` (unstrand it) + throw (→
      // `on('failed')` logs + captures + retries; a token-rotation race then recovers).
      if (!post) {
        // Row vanished between the scheduler's claim and here — nothing to unstrand.
        throw new Error(`publish: scheduled post ${scheduledPostId} not found`);
      }

      // Resolve the account's provider so we build the RIGHT connector.
      const [account] = await ctx.db
        .select({ provider: socialAccounts.provider })
        .from(socialAccounts)
        .where(and(eq(socialAccounts.id, post.socialAccountId), eq(socialAccounts.orgId, orgId)))
        .limit(1);
      if (!account) {
        await markPublishFailed(ctx, orgId, scheduledPostId);
        throw new Error(
          `publish: scheduled post ${scheduledPostId} — social account ${post.socialAccountId} missing/disconnected`,
        );
      }

      const [tok] = await ctx.db
        .select()
        .from(connectorTokens)
        .where(eq(connectorTokens.socialAccountId, post.socialAccountId))
        .limit(1);
      if (!tok) {
        await markPublishFailed(ctx, orgId, scheduledPostId);
        throw new Error(
          `publish: scheduled post ${scheduledPostId} — connector token missing for account ${post.socialAccountId}`,
        );
      }

      const accessToken = decryptToken(tok.accessTokenEnc);
      const connector = createConnector(account.provider);
      return ctx.publishing.processScheduledPost(orgId, scheduledPostId, connector, accessToken);
    },
    { connection, concurrency: 3 },
  );
}

/**
 * Move a claimed post out of `publishing` into `failed` so a missing prerequisite
 * (disconnected account / absent token) never strands it in the `publishing` state
 * the scheduler set. Org-scoped; the caller then throws so the failure is surfaced.
 */
async function markPublishFailed(
  ctx: WorkerContext,
  orgId: string,
  scheduledPostId: string,
): Promise<void> {
  await ctx.db
    .update(scheduledPosts)
    .set({ status: 'failed' })
    .where(and(eq(scheduledPosts.id, scheduledPostId), eq(scheduledPosts.orgId, orgId)));
}
