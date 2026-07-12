import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@brandpilot/observability';
import { runDailyTick, runPublishTick, runCommentsTick } from './scheduler';
import type { WorkerContext } from './context';

/**
 * `runPublishTick` and `runDailyTick` are module-private in `scheduler.ts`.
 * Both are exported there (narrow, test-only exports mirroring
 * `buildPlanLimitsResolver` in `./context.ts`) purely so they can be driven
 * directly with a fake `ctx.db` / `ctx.producers` here, instead of through a
 * real BullMQ worker + Redis connection.
 */

interface ScheduledPostRow {
  id: string;
  orgId: string;
}

interface OrgRow {
  id: string;
}

/**
 * Minimal chainable fake for the one `ctx.db` call shape `runDailyTick` makes:
 * `db.select({ id }).from(organizations)`, awaited directly (no further
 * chaining) — resolves straight to `orgs`. Mirrors the `createFakeDb` /
 * `createFakeRedis` style in `context.test.ts` / `redis-spend-guard.test.ts`:
 * a plain object exposing only the method actually called.
 */
function createDailyTickDb(orgs: OrgRow[]): { db: WorkerContext['db']; select: ReturnType<typeof vi.fn> } {
  const from = vi.fn(() => Promise.resolve(orgs));
  const select = vi.fn(() => ({ from }));
  return { db: { select } as unknown as WorkerContext['db'], select };
}

/**
 * Minimal chainable fake for the two `ctx.db` call shapes `runPublishTick`
 * makes, mirroring the exact chains in `scheduler.ts`:
 *   - due lookup: `select({...}).from(scheduledPosts).where().orderBy().limit()` → `due`
 *   - bulk claim: `update(scheduledPosts).set({...}).where().returning()`        → `claimed`
 * `claimed` defaults to `due` (every due row gets claimed) so tests only need
 * to pass it explicitly when exercising the optimistic-claim-loss case.
 */
function createPublishTickDb(opts: { due: ScheduledPostRow[]; claimed?: ScheduledPostRow[] }): {
  db: WorkerContext['db'];
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  const claimed = opts.claimed ?? opts.due;

  const limit = vi.fn(() => Promise.resolve(opts.due));
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const returning = vi.fn(() => Promise.resolve(claimed));
  const updateWhere = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return { db: { select, update } as unknown as WorkerContext['db'], select, update, set };
}

/**
 * Fake `ctx.producers` exposing only the three `.add()` calls the two ticks
 * make. Each defaults to resolving `undefined`; pass an `*AddImpl` override to
 * make a specific call reject (behavior is swappable at creation time, same
 * as `findFirstImpl` in `context.test.ts`'s fake db, rather than mutated after
 * the fact).
 */
function createFakeProducers(overrides?: {
  publishAddImpl?: (name: string, data: { orgId: string; scheduledPostId: string }) => Promise<unknown>;
  brainReindexAddImpl?: (name: string, data: { orgId: string }) => Promise<unknown>;
  commentsPollAddImpl?: (name: string, data: { orgId: string }) => Promise<unknown>;
}): {
  producers: WorkerContext['producers'];
  publishAdd: ReturnType<typeof vi.fn>;
  brainReindexAdd: ReturnType<typeof vi.fn>;
  analyticsRollupAdd: ReturnType<typeof vi.fn>;
  commentsPollAdd: ReturnType<typeof vi.fn>;
} {
  const publishAdd = vi.fn(overrides?.publishAddImpl ?? (() => Promise.resolve(undefined)));
  const brainReindexAdd = vi.fn(overrides?.brainReindexAddImpl ?? (() => Promise.resolve(undefined)));
  const analyticsRollupAdd = vi.fn(() => Promise.resolve(undefined));
  const commentsPollAdd = vi.fn(overrides?.commentsPollAddImpl ?? (() => Promise.resolve(undefined)));

  const producers = {
    publish: { add: publishAdd },
    brainReindex: { add: brainReindexAdd },
    analyticsRollup: { add: analyticsRollupAdd },
    commentsPoll: { add: commentsPollAdd },
  } as unknown as WorkerContext['producers'];

  return { producers, publishAdd, brainReindexAdd, analyticsRollupAdd, commentsPollAdd };
}

/**
 * Minimal chainable fake for the one `ctx.db` call shape `runCommentsTick` makes:
 * `db.selectDistinct({ id }).from(socialAccounts).where(...)`, awaited directly
 * → resolves straight to the distinct org rows.
 */
function createCommentsTickDb(orgs: OrgRow[]): { db: WorkerContext['db'] } {
  const where = vi.fn(() => Promise.resolve(orgs));
  const from = vi.fn(() => ({ where }));
  const selectDistinct = vi.fn(() => ({ from }));
  return { db: { selectDistinct } as unknown as WorkerContext['db'] };
}

function buildCtx(db: WorkerContext['db'], producers: WorkerContext['producers']): WorkerContext {
  return { db, producers } as unknown as WorkerContext;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runCommentsTick', () => {
  it('enqueues one comments.poll per org that has a connected instagram account', async () => {
    const orgs: OrgRow[] = [{ id: 'org_a' }, { id: 'org_b' }];
    const { db } = createCommentsTickDb(orgs);
    const { producers, commentsPollAdd } = createFakeProducers();

    const result = await runCommentsTick(buildCtx(db, producers));

    expect(result).toEqual({ orgs: 2, failed: 0 });
    expect(commentsPollAdd).toHaveBeenCalledTimes(2);
    expect(commentsPollAdd).toHaveBeenCalledWith('poll', { orgId: 'org_a' });
    expect(commentsPollAdd).toHaveBeenCalledWith('poll', { orgId: 'org_b' });
  });

  it('enqueues nothing when no instagram account is connected', async () => {
    const { db } = createCommentsTickDb([]);
    const { producers, commentsPollAdd } = createFakeProducers();

    const result = await runCommentsTick(buildCtx(db, producers));

    expect(result).toEqual({ orgs: 0, failed: 0 });
    expect(commentsPollAdd).not.toHaveBeenCalled();
  });

  it('counts a failed enqueue without aborting the rest', async () => {
    const orgs: OrgRow[] = [{ id: 'org_a' }, { id: 'org_b' }];
    const { db } = createCommentsTickDb(orgs);
    const { producers, commentsPollAdd } = createFakeProducers({
      commentsPollAddImpl: (_name, data) =>
        data.orgId === 'org_a' ? Promise.reject(new Error('redis down')) : Promise.resolve(undefined),
    });
    vi.spyOn(logger, 'error').mockImplementation(() => logger);

    const result = await runCommentsTick(buildCtx(db, producers));

    expect(result).toEqual({ orgs: 2, failed: 1 });
    expect(commentsPollAdd).toHaveBeenCalledTimes(2); // org_b still attempted
  });
});

describe('runPublishTick', () => {
  it('claims due posts via one bulk update().set().where().returning() and enqueues one dispatch per claimed row', async () => {
    const due: ScheduledPostRow[] = [
      { id: 'post_1', orgId: 'org_a' },
      { id: 'post_2', orgId: 'org_a' },
      { id: 'post_3', orgId: 'org_b' },
    ];
    const { db, update, set } = createPublishTickDb({ due });
    const { producers, publishAdd } = createFakeProducers();

    const result = await runPublishTick(buildCtx(db, producers));

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ status: 'publishing' });
    expect(result).toEqual({ enqueued: 3 });
    expect(publishAdd).toHaveBeenCalledTimes(3);
    for (const post of due) {
      expect(publishAdd).toHaveBeenCalledWith('dispatch', { orgId: post.orgId, scheduledPostId: post.id });
    }
  });

  it('only enqueues rows the claim actually returned, not every row that was due (optimistic concurrency)', async () => {
    const due: ScheduledPostRow[] = [
      { id: 'post_1', orgId: 'org_a' },
      { id: 'post_2', orgId: 'org_a' },
      { id: 'post_3', orgId: 'org_b' },
    ];
    // post_2 was concurrently flipped out of `status = 'scheduled'` by another
    // tick/process between the SELECT and the UPDATE, so RETURNING omits it.
    const claimed: ScheduledPostRow[] = [due[0]!, due[2]!];
    const { db } = createPublishTickDb({ due, claimed });
    const { producers, publishAdd } = createFakeProducers();

    const result = await runPublishTick(buildCtx(db, producers));

    expect(result).toEqual({ enqueued: 2 });
    expect(publishAdd).toHaveBeenCalledTimes(2);
    expect(publishAdd).toHaveBeenCalledWith('dispatch', { orgId: 'org_a', scheduledPostId: 'post_1' });
    expect(publishAdd).toHaveBeenCalledWith('dispatch', { orgId: 'org_b', scheduledPostId: 'post_3' });
    expect(publishAdd).not.toHaveBeenCalledWith('dispatch', { orgId: 'org_a', scheduledPostId: 'post_2' });
  });

  it('issues no UPDATE and enqueues nothing when no posts are due', async () => {
    const { db, update } = createPublishTickDb({ due: [] });
    const { producers, publishAdd } = createFakeProducers();

    const result = await runPublishTick(buildCtx(db, producers));

    expect(result).toEqual({ enqueued: 0 });
    expect(update).not.toHaveBeenCalled();
    expect(publishAdd).not.toHaveBeenCalled();
  });

  it('isolates one failed enqueue: the surviving rows still enqueue and the tick does not throw', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const due: ScheduledPostRow[] = [
      { id: 'post_1', orgId: 'org_a' },
      { id: 'post_2', orgId: 'org_a' },
      { id: 'post_3', orgId: 'org_b' },
    ];
    const { db } = createPublishTickDb({ due });
    const { producers, publishAdd } = createFakeProducers({
      publishAddImpl: (_name, data) =>
        data.scheduledPostId === 'post_2' ? Promise.reject(new Error('redis blip')) : Promise.resolve(undefined),
    });

    await expect(runPublishTick(buildCtx(db, producers))).resolves.toEqual({ enqueued: 3 });

    expect(publishAdd).toHaveBeenCalledTimes(3);
    expect(publishAdd).toHaveBeenCalledWith('dispatch', { orgId: 'org_a', scheduledPostId: 'post_1' });
    expect(publishAdd).toHaveBeenCalledWith('dispatch', { orgId: 'org_b', scheduledPostId: 'post_3' });
    expect(errorSpy).toHaveBeenCalledWith(
      { err: expect.any(Error), orgId: 'org_a', scheduledPostId: 'post_2' },
      'publish tick enqueue failed',
    );
  });
});

describe('runDailyTick', () => {
  it('processes every org across bounded batches (60 orgs, comfortably over the DAILY_TICK_ORG_BATCH boundary of 25)', async () => {
    const ORG_COUNT = 60;
    const orgs: OrgRow[] = Array.from({ length: ORG_COUNT }, (_, i) => ({ id: `org_${i}` }));
    const { db } = createDailyTickDb(orgs);
    const { producers, brainReindexAdd, analyticsRollupAdd } = createFakeProducers();

    const result = await runDailyTick(buildCtx(db, producers));

    expect(result).toEqual({ orgs: ORG_COUNT, failed: 0 });
    expect(brainReindexAdd).toHaveBeenCalledTimes(ORG_COUNT);
    expect(analyticsRollupAdd).toHaveBeenCalledTimes(ORG_COUNT);
    for (const org of orgs) {
      expect(brainReindexAdd).toHaveBeenCalledWith('reindex', { orgId: org.id });
      expect(analyticsRollupAdd).toHaveBeenCalledWith('rollup', { orgId: org.id });
    }
  });

  it('isolates a per-org enqueue rejection: the other orgs still process and `failed` reflects the failure', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const orgs: OrgRow[] = [{ id: 'org_a' }, { id: 'org_b' }, { id: 'org_c' }];
    const { db } = createDailyTickDb(orgs);
    const { producers, brainReindexAdd, analyticsRollupAdd } = createFakeProducers({
      brainReindexAddImpl: (_name, data) =>
        data.orgId === 'org_b' ? Promise.reject(new Error('queue full')) : Promise.resolve(undefined),
    });

    const result = await runDailyTick(buildCtx(db, producers));

    expect(result).toEqual({ orgs: 3, failed: 1 });
    expect(brainReindexAdd).toHaveBeenCalledTimes(3);
    // org_b's body awaits brainReindex.add before calling analyticsRollup.add,
    // so the rejection short-circuits ITS OWN analyticsRollup call only — the
    // other two orgs are untouched (still 2 analyticsRollup calls, not 3).
    expect(analyticsRollupAdd).toHaveBeenCalledTimes(2);
    expect(analyticsRollupAdd).not.toHaveBeenCalledWith('rollup', { orgId: 'org_b' });
    expect(errorSpy).toHaveBeenCalledWith(
      { err: expect.any(Error), orgId: 'org_b' },
      'daily tick enqueue failed for org',
    );
  });
});
