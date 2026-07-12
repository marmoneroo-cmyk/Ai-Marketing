import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { QUEUES, type CommentsPollJobData } from '@brandpilot/core';
import type { WorkerContext } from '../context';
import { pullInstagramComments } from '../instagram-comments';

/**
 * Poll an org's Instagram media for new comments and ingest them into the inbox.
 * Enqueued per org by the scheduler's `comments.tick`. The heavy lifting (pull +
 * dedup + reply/escalate) lives in {@link pullInstagramComments}; this is just
 * the durable, retryable queue wrapper.
 */
export function createCommentsPollWorker(ctx: WorkerContext, connection: IORedis): Worker<CommentsPollJobData> {
  return new Worker<CommentsPollJobData>(
    QUEUES.commentsPoll,
    async (job: Job<CommentsPollJobData>) => {
      const { orgId } = job.data;
      const ingested = await pullInstagramComments(ctx, orgId);
      return { ingested };
    },
    { connection, concurrency: 2 },
  );
}
