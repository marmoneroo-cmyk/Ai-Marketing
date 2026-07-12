import { Queue, Worker, type Job } from 'bullmq';
import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { organizations, scheduledPosts, socialAccounts, workflows } from '@brandpilot/db';
import { logger, captureError } from '@brandpilot/observability';
import type { WorkerContext } from './context';
import { cronMatchesMinute, type WorkflowTrigger } from '@brandpilot/automation';

/**
 * The autonomous clock. A dedicated BullMQ queue owns three repeatable job
 * schedulers; a Worker on that same queue fans each tick out to real work:
 *
 *   - `daily.tick`        → per-org brain reindex + analytics rollup
 *   - `publish.tick`      → claim & dispatch due, approved scheduled posts
 *   - `workflow.tick`     → run due schedule-triggered workflows
 *   - `comments.tick`     → poll connected Instagram accounts for new comments
 *
 * Recurrence is delegated to BullMQ (`upsertJobScheduler`), so the cadence
 * survives restarts and never double-fires across replicas sharing Redis.
 */

const SCHEDULER_QUEUE = 'brandpilot.scheduler';

const TICKS = {
  daily: 'daily.tick',
  publish: 'publish.tick',
  workflow: 'workflow.tick',
  comments: 'comments.tick',
} as const;

/** Cron: 06:00 UTC daily. Kept as a constant so the cadence is obvious + testable. */
const DAILY_CRON = '0 6 * * *';
const MINUTE_MS = 60_000;
/**
 * How often to poll Instagram for new comments. 10 minutes balances inbox
 * freshness against the IG API + per-comment LLM cost (each new comment drafts a
 * reply); comment dedup means a re-poll of already-seen comments is cheap.
 */
const COMMENTS_POLL_INTERVAL_MS = 10 * MINUTE_MS;

/** How many due posts / workflows to drain per tick (bounded to protect Redis + DB). */
const TICK_BATCH_LIMIT = 200;

/**
 * Bounded fan-out width for the daily tick's per-org enqueue pairs. Org count
 * grows over time and each org fans out into two queue `.add()` calls — left
 * unbounded, `Promise.allSettled` over every org would put an ever-growing
 * number of concurrent enqueues on Redis at once. Unlike `TICK_BATCH_LIMIT`,
 * this must NOT drop any org from the tick (skipping an org's daily
 * reindex/analytics run is a correctness bug, not an acceptable backpressure
 * trade-off) — it only bounds how many orgs are in flight together, via
 * sequential batches that together still cover every org.
 */
const DAILY_TICK_ORG_BATCH = 25;

export interface Scheduler {
  queue: Queue;
  worker: Worker;
}

/**
 * Register the repeatable schedulers and start the tick worker. Returns the
 * queue + worker so the entrypoint can close them on shutdown.
 */
export async function startScheduler(ctx: WorkerContext): Promise<Scheduler> {
  const { connection } = ctx;
  const queue = new Queue(SCHEDULER_QUEUE, { connection });

  // BullMQ re-emits Redis connection errors as the Queue/Worker's own 'error'
  // event; with no listener attached, Node treats it as unhandled and crashes
  // the whole process — including every domain worker sharing this process.
  queue.on('error', (err) => {
    logger.error({ err, queue: SCHEDULER_QUEUE }, 'scheduler queue error');
    captureError(err, { queue: SCHEDULER_QUEUE });
  });

  await queue.upsertJobScheduler(TICKS.daily, { pattern: DAILY_CRON }, { name: TICKS.daily });
  await queue.upsertJobScheduler(TICKS.publish, { every: MINUTE_MS }, { name: TICKS.publish });
  await queue.upsertJobScheduler(TICKS.workflow, { every: MINUTE_MS }, { name: TICKS.workflow });
  await queue.upsertJobScheduler(
    TICKS.comments,
    { every: COMMENTS_POLL_INTERVAL_MS },
    { name: TICKS.comments },
  );

  const worker = new Worker(
    SCHEDULER_QUEUE,
    async (job: Job) => {
      switch (job.name) {
        case TICKS.daily:
          return runDailyTick(ctx);
        case TICKS.publish:
          return runPublishTick(ctx);
        case TICKS.workflow:
          return runWorkflowTick(ctx);
        case TICKS.comments:
          return runCommentsTick(ctx);
        default:
          return { skipped: job.name };
      }
    },
    { connection, concurrency: 1 },
  );

  worker.on('error', (err) => {
    logger.error({ err, queue: SCHEDULER_QUEUE }, 'scheduler worker error');
    captureError(err, { queue: SCHEDULER_QUEUE });
  });

  logger.info({ ticks: Object.values(TICKS) }, 'scheduler started');
  return { queue, worker };
}

/** Split `items` into consecutive chunks of at most `size` items each. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Daily learning loop: enqueue a brain reindex + analytics rollup for every org.
 * One enqueue per org keeps each unit of work retryable + observable on its own.
 *
 * Orgs are processed in `DAILY_TICK_ORG_BATCH`-sized sequential batches so at
 * most that many enqueue-pairs are in flight at once — every org is still
 * covered, just not all concurrently.
 *
 * Uses `Promise.allSettled` (not `Promise.all`) so one org's enqueue failure
 * can never hide — or abort awaiting — another org's. Each rejection is logged
 * + reported individually with its `orgId`.
 *
 * Exported so tests can exercise it directly against a fake `ctx.db` /
 * `ctx.producers` instead of driving it through a real BullMQ worker (mirrors
 * `buildPlanLimitsResolver` in `./context.ts`).
 */
export async function runDailyTick(ctx: WorkerContext): Promise<{ orgs: number; failed: number }> {
  const orgs = await ctx.db.select({ id: organizations.id }).from(organizations);

  let failed = 0;
  for (const batch of chunk(orgs, DAILY_TICK_ORG_BATCH)) {
    const results = await Promise.allSettled(
      batch.map(async (org) => {
        await ctx.producers.brainReindex.add('reindex', { orgId: org.id });
        await ctx.producers.analyticsRollup.add('rollup', { orgId: org.id });
      }),
    );

    results.forEach((result, index) => {
      if (result.status !== 'rejected') return;
      failed++;
      const orgId = batch[index]?.id;
      logger.error({ err: result.reason, orgId }, 'daily tick enqueue failed for org');
      captureError(result.reason, { orgId });
    });
  }

  logger.info({ orgs: orgs.length, failed }, 'daily tick enqueued');
  return { orgs: orgs.length, failed };
}

/**
 * Comment-poll loop: enqueue a `comments.poll` job for every org that has a
 * connected Instagram account, so the inbox ingests new comments. Batched +
 * `Promise.allSettled` (same shape as {@link runDailyTick}) so one org's enqueue
 * failure neither hides nor aborts another's. Orgs without a connected Instagram
 * account are simply absent — no wasted jobs.
 *
 * Exported so tests can drive it against a fake `ctx.db` / `ctx.producers`.
 */
export async function runCommentsTick(ctx: WorkerContext): Promise<{ orgs: number; failed: number }> {
  const orgs = await ctx.db
    .selectDistinct({ id: socialAccounts.orgId })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.provider, 'instagram'), eq(socialAccounts.status, 'connected')));

  let failed = 0;
  for (const batch of chunk(orgs, DAILY_TICK_ORG_BATCH)) {
    const results = await Promise.allSettled(
      batch.map((org) => ctx.producers.commentsPoll.add('poll', { orgId: org.id })),
    );
    results.forEach((result, index) => {
      if (result.status !== 'rejected') return;
      failed++;
      const orgId = batch[index]?.id;
      logger.error({ err: result.reason, orgId }, 'comments tick enqueue failed for org');
      captureError(result.reason, { orgId });
    });
  }

  if (orgs.length > 0) {
    logger.info({ orgs: orgs.length, failed }, 'comments tick enqueued');
  } else {
    logger.debug({ orgs: 0 }, 'comments tick found no connected instagram accounts');
  }
  return { orgs: orgs.length, failed };
}

/**
 * Publish loop: find posts that are scheduled, approved, and due, atomically
 * claim ALL of them in one bulk UPDATE (the WHERE guard — id IN the due set
 * AND status still `scheduled` — is applied atomically per row by Postgres,
 * so the claim is just as idempotent across concurrent ticks as claiming
 * row-by-row, in one round-trip instead of up to `TICK_BATCH_LIMIT`), then
 * enqueue the publish job per claimed row. The publish worker records the
 * attempt + terminal status.
 *
 * Exported so tests can exercise it directly against a fake `ctx.db` /
 * `ctx.producers` instead of driving it through a real BullMQ worker (mirrors
 * `buildPlanLimitsResolver` in `./context.ts`).
 */
export async function runPublishTick(ctx: WorkerContext): Promise<{ enqueued: number }> {
  const now = new Date();
  const due = await ctx.db
    .select({ id: scheduledPosts.id, orgId: scheduledPosts.orgId })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.status, 'scheduled'),
        isNotNull(scheduledPosts.approvedAt),
        lte(scheduledPosts.scheduledFor, now),
      ),
    )
    // Oldest-due first: without an explicit order, Postgres's row order is
    // arbitrary, so once the due backlog exceeds TICK_BATCH_LIMIT the SAME
    // rows can keep losing the LIMIT cutoff tick after tick, starving them.
    // Oldest-first is a stable, fair processing order under sustained backlog.
    .orderBy(asc(scheduledPosts.scheduledFor))
    .limit(TICK_BATCH_LIMIT);

  if (due.length === 0) {
    logger.debug({ enqueued: 0 }, 'publish tick found nothing due');
    return { enqueued: 0 };
  }

  // Claim: ONE bulk UPDATE atomically flips every still-`scheduled` due row to
  // `publishing`. A row another tick/process already claimed between the
  // SELECT above and this UPDATE no longer matches `status = 'scheduled'`, so
  // it's simply absent from `RETURNING` — the same optimistic-concurrency
  // guarantee the old one-UPDATE-per-row loop gave.
  const dueIds = due.map((post) => post.id);
  const claimed = await ctx.db
    .update(scheduledPosts)
    .set({ status: 'publishing' })
    .where(and(inArray(scheduledPosts.id, dueIds), eq(scheduledPosts.status, 'scheduled')))
    .returning({ id: scheduledPosts.id, orgId: scheduledPosts.orgId });
  const enqueued = claimed.length;

  for (const post of claimed) {
    try {
      await ctx.producers.publish.add('dispatch', { orgId: post.orgId, scheduledPostId: post.id });
    } catch (err) {
      // Isolation: every row here is already claimed (flipped to `publishing`)
      // before its enqueue is attempted, so one failed `.add()` must not abort
      // the rest of the batch — every other claimed row still gets dispatched.
      logger.error({ err, orgId: post.orgId, scheduledPostId: post.id }, 'publish tick enqueue failed');
      captureError(err, { orgId: post.orgId, scheduledPostId: post.id });
    }
  }

  // Unconditional heartbeat: "ran, nothing due" must be distinguishable from
  // "the scheduler stopped running" in the logs.
  if (enqueued > 0) {
    logger.info({ enqueued }, 'publish tick dispatched');
  } else {
    logger.debug({ enqueued }, 'publish tick found nothing due');
  }
  return { enqueued };
}

/** Type guard: a jsonb `trigger` value that is a schedule trigger. */
function isScheduleTrigger(value: unknown): value is Extract<WorkflowTrigger, { type: 'schedule' }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'schedule' &&
    typeof (value as { cron?: unknown }).cron === 'string'
  );
}

/**
 * Schedule-workflow loop: run enabled workflows whose trigger is a schedule AND
 * whose cron expression is due at this minute. Cron is owned by the worker
 * (never the engine); `cronMatchesMinute` evaluates each expression against the
 * per-minute tick so a weekly workflow runs weekly — not on every tick.
 * Signal-triggered workflows are untouched here — they fire via the signal bridge.
 */
async function runWorkflowTick(ctx: WorkerContext): Promise<{ ran: number }> {
  const now = new Date();
  const candidates = await ctx.db
    .select({
      id: workflows.id,
      orgId: workflows.orgId,
      trigger: workflows.trigger,
      timezone: organizations.timezone,
    })
    .from(workflows)
    .innerJoin(organizations, eq(organizations.id, workflows.orgId))
    .where(eq(workflows.enabled, true))
    // Oldest-created first: `workflows` has no due-at column (dueness is the
    // in-memory cron check below), so createdAt is the stable fairness
    // tiebreaker — without it, once enabled workflows exceed TICK_BATCH_LIMIT,
    // Postgres's arbitrary row order can starve the same ones every tick.
    .orderBy(asc(workflows.createdAt))
    .limit(TICK_BATCH_LIMIT);

  let ran = 0;
  for (const wf of candidates) {
    if (!isScheduleTrigger(wf.trigger)) continue;
    // Only run when the cron is actually due this minute in the org's local time
    // (else it would fire every tick / at the wrong local hour).
    if (!cronMatchesMinute(wf.trigger.cron, now, wf.timezone)) continue;
    try {
      await ctx.automation.runWorkflow(wf.orgId, wf.id, { trigger: 'schedule', cron: wf.trigger.cron });
      ran++;
    } catch (err) {
      logger.error({ err, workflowId: wf.id }, 'schedule workflow run failed');
    }
  }

  // Unconditional heartbeat: "ran, nothing due" must be distinguishable from
  // "the scheduler stopped running" in the logs.
  if (ran > 0) {
    logger.info({ ran }, 'workflow tick ran schedule workflows');
  } else {
    logger.debug({ ran }, 'workflow tick found nothing due');
  }
  return { ran };
}
