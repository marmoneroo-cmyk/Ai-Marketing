import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArgumentMetadata } from '@nestjs/common';
import type { ApiResponse } from '@brandpilot/core';

/**
 * `ApprovalsController.list()` tests for the quote-value join.
 *
 * Bug: neither `approvals.controller.ts` nor `dashboard.controller.ts` ever
 * populated `PendingApproval.value` for a `quote`-type approval — the
 * `approvals` table has no amount column, so the dollar figure (which the web
 * renders as a currency badge) only ever lived in the free-text `summary`.
 * Both mappers now batch-load it from `quotes.total` via the shared
 * `loadQuoteApprovalValues` helper (see `read-model.mappers.spec.ts` for its
 * dedicated unit tests: batching, org-scoping, non-quote rows skipped).
 *
 * `withOrgScope` is stubbed to run `list()`'s callback against a fake `tx`
 * whose `.select(...)` returns a chainable, thenable query builder resolving
 * to the next fixture pulled off an ordered queue. `list()` runs its two
 * selects SEQUENTIALLY (approvals, then — inside `loadQuoteApprovalValues` —
 * quotes), so each test seeds fixtures in that exact order, mirroring the
 * idiom in `content.controller.spec.ts`.
 *
 * `batchDecide()`'s tests (below) additionally exercise `tx.update(...)`, faked
 * the same way `conversations.controller.spec.ts` does: `.set()` records what
 * was written, `.where()` records the filter condition, and `.returning()`
 * resolves the next fixture off its own queue. `inArray` is partially mocked
 * (real behavior preserved) purely to capture the exact id list it was called
 * with.
 */
const { state } = vi.hoisted(() => ({
  state: {
    rowsQueue: [] as unknown[][],
    updateReturningQueue: [] as unknown[][],
    updateSetCalls: [] as unknown[],
    updateWhereCalls: [] as unknown[],
    inArrayCalls: [] as unknown[][],
  },
}));

vi.mock('drizzle-orm', async (importActual) => {
  const actual = await importActual<typeof import('drizzle-orm')>();
  return {
    ...actual,
    inArray: (column: unknown, values: unknown[]) => {
      state.inArrayCalls.push(values);
      return actual.inArray(column as never, values as never);
    },
  };
});

vi.mock('@brandpilot/db', async (importActual) => {
  const actual = await importActual<typeof import('@brandpilot/db')>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duck-typed fake query builder
  function chain(): any {
    const builder: any = {};
    const self = () => builder;
    builder.from = self;
    builder.orderBy = self;
    builder.limit = self;
    builder.where = self;
    builder.then = (resolve: (rows: unknown[]) => void, reject?: (err: unknown) => void) =>
      Promise.resolve(state.rowsQueue.shift() ?? []).then(resolve, reject);
    return builder;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duck-typed fake query builder
  function updateChain(): any {
    const builder: any = {};
    builder.set = (setValues: unknown) => {
      state.updateSetCalls.push(setValues);
      return builder;
    };
    builder.where = (condition: unknown) => {
      state.updateWhereCalls.push(condition);
      return builder;
    };
    builder.returning = () => Promise.resolve(state.updateReturningQueue.shift() ?? []);
    return builder;
  }

  const tx = { select: () => chain(), update: () => updateChain() };

  return {
    ...actual,
    withOrgScope: (_db: unknown, _orgId: string, cb: (t: unknown) => unknown) => cb(tx),
  };
});

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ApprovalsController, batchDecideSchema, BatchDecideBody } from './approvals.controller';
import type { AuthContext } from '../auth/jwt.strategy';

/** Seed the fake tx's per-`select()` fixture queue, in call order. */
function seedRows(...rowSets: unknown[][]): void {
  state.rowsQueue = [...rowSets];
}

/** Seed the fake tx's `.update().returning()` fixture queue, in call order. */
function seedUpdateReturning(...rowSets: unknown[][]): void {
  state.updateReturningQueue = [...rowSets];
}

/**
 * Deep-search an object graph's own enumerable properties for a string value.
 * Real Drizzle conditions (from the un-mocked `and`/`eq`/`inArray`) hold
 * circular references back to table metadata, so `JSON.stringify` throws —
 * this walks the graph instead, guarding against cycles. Mirrors the idiom in
 * `content.controller.spec.ts`.
 */
function deepIncludesValue(node: unknown, target: string, seen: Set<unknown> = new Set()): boolean {
  if (node === target) return true;
  if (node === null || typeof node !== 'object') return false;
  if (seen.has(node)) return false;
  seen.add(node);
  for (const value of Object.values(node as Record<string, unknown>)) {
    if (deepIncludesValue(value, target, seen)) return true;
  }
  return false;
}

/** Narrow the envelope's `{success:true}` branch, failing loudly otherwise. */
function expectSuccess<T>(response: ApiResponse<T>): T {
  if (!response.success) {
    throw new Error(
      `expected a success envelope, got error: ${response.error.code} — ${response.error.message}`,
    );
  }
  return response.data;
}

describe('ApprovalsController.list — quote value join', () => {
  let controller: ApprovalsController;

  beforeEach(() => {
    state.rowsQueue = [];
    controller = new ApprovalsController({} as never, { add: vi.fn() } as never);
  });

  it('surfaces a numeric `value` for a quote-type approval, sourced from quotes.total', async () => {
    seedRows(
      [
        {
          id: 'approval-1',
          kind: 'quote',
          targetType: 'quote',
          targetId: 'quote-1',
          summary: 'Quote for Acme Co. Total $499.99, valid 30 days.',
          confidence: '0.9',
          createdAt: new Date('2026-07-01T00:00:00Z'),
        },
      ], // approvals select
      [{ id: 'quote-1', total: '499.99' }], // quotes select (inside loadQuoteApprovalValues)
    );

    const items = expectSuccess(await controller.list('org-1'));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'approval-1', value: 499.99 });
  });

  it('omits `value` for a non-quote approval, and never queries quotes for it', async () => {
    seedRows(
      [
        {
          id: 'approval-2',
          kind: 'content',
          targetType: 'content_item',
          targetId: 'item-1',
          summary: 'Approve this post before it publishes.',
          confidence: '0.8',
          createdAt: new Date('2026-07-01T00:00:00Z'),
        },
      ], // approvals select
      // no quotes fixture queued — loadQuoteApprovalValues must short-circuit
    );

    const items = expectSuccess(await controller.list('org-1'));
    expect(items[0]).not.toHaveProperty('value');
  });

  it('omits `value` when the approval is quote-typed but the quote row no longer matches', async () => {
    seedRows(
      [
        {
          id: 'approval-3',
          kind: 'quote',
          targetType: 'quote',
          targetId: 'quote-missing',
          summary: 'Quote pending review.',
          confidence: '0.7',
          createdAt: new Date('2026-07-01T00:00:00Z'),
        },
      ], // approvals select
      [], // quotes select returns nothing (deleted / cross-org)
    );

    const items = expectSuccess(await controller.list('org-1'));
    expect(items[0]).not.toHaveProperty('value');
  });
});

/**
 * `ApprovalsController.batchDecide()` tests: the set-based `POST
 * /approvals/batch` route. The fake `tx.update(...).set(...).where(...)`
 * always resolves via `.returning()` to whatever `seedUpdateReturning` queued
 * — standing in for the real WHERE `id = ANY(ids) AND org_id = orgId AND
 * status = 'pending'`, which is what actually does the org/status filtering
 * against a real database. Because this fake never evaluates predicates, a
 * "cross-tenant id is skipped" test seeds only the ids that would have
 * survived that WHERE and asserts they're the only ones in `decided` — the
 * real guarantee (that a cross-tenant id can never be returned or written) is
 * the SQL predicate itself, exercised end-to-end in integration/e2e tests.
 */
describe('ApprovalsController.batchDecide', () => {
  let resumeQueueAdd: ReturnType<typeof vi.fn>;
  let controller: ApprovalsController;

  const USER: AuthContext = { userId: 'user-1', orgId: 'org-1', role: 'owner' };

  beforeEach(() => {
    state.rowsQueue = [];
    state.updateReturningQueue = [];
    state.updateSetCalls = [];
    state.updateWhereCalls = [];
    state.inArrayCalls = [];
    resumeQueueAdd = vi.fn();
    controller = new ApprovalsController({} as never, { add: resumeQueueAdd } as never);
  });

  it('transitions only the claimed ids and returns exactly those as `decided`', async () => {
    seedUpdateReturning([
      { id: 'apr-1', kind: 'content', targetId: 'item-1' },
      { id: 'apr-2', kind: 'content', targetId: 'item-2' },
    ]);

    const result = expectSuccess(
      await controller.batchDecide('org-1', USER, {
        ids: ['apr-1', 'apr-2', 'apr-3'],
        decision: 'approve',
      }),
    );

    expect(result).toEqual({ decided: ['apr-1', 'apr-2'] });
    expect(state.updateSetCalls[0]).toMatchObject({ status: 'approved', decidedBy: 'user-1' });
    // The full requested id list (including one the DB will end up skipping)
    // is what's passed to the WHERE guard — filtering happens at the SQL
    // layer, not by special-casing any id here.
    expect(state.inArrayCalls).toEqual([['apr-1', 'apr-2', 'apr-3']]);
  });

  it('applies "rejected" status + the caller as decidedBy for a reject decision', async () => {
    seedUpdateReturning([{ id: 'apr-5', kind: 'content', targetId: 'item-5' }]);

    await controller.batchDecide('org-1', USER, { ids: ['apr-5'], decision: 'reject' });

    expect(state.updateSetCalls[0]).toMatchObject({ status: 'rejected', decidedBy: 'user-1' });
  });

  it('silently skips a cross-tenant (or already-decided) id: no throw, and it is absent from `decided`', async () => {
    // Only `apr-1` belongs to org-1 and is still pending; `apr-other-org`
    // never comes back even though it was requested — the real WHERE (org_id
    // = orgId AND status = 'pending') is what filters it out server-side.
    seedUpdateReturning([{ id: 'apr-1', kind: 'content', targetId: 'item-1' }]);

    const result = expectSuccess(
      await controller.batchDecide('org-1', USER, {
        ids: ['apr-1', 'apr-other-org'],
        decision: 'approve',
      }),
    );

    expect(result.decided).toEqual(['apr-1']);
    expect(result.decided).not.toContain('apr-other-org');
  });

  it('never touches another org: the claim query is scoped to the caller\'s own org id', async () => {
    seedUpdateReturning([{ id: 'apr-1', kind: 'content', targetId: 'item-1' }]);
    await controller.batchDecide('org-1', USER, { ids: ['apr-1'], decision: 'approve' });
    const whereForOrg1 = state.updateWhereCalls[0];

    state.updateWhereCalls = [];
    seedUpdateReturning([{ id: 'apr-1', kind: 'content', targetId: 'item-1' }]);
    await controller.batchDecide('org-2', { ...USER, orgId: 'org-2' }, {
      ids: ['apr-1'],
      decision: 'approve',
    });
    const whereForOrg2 = state.updateWhereCalls[0];

    expect(deepIncludesValue(whereForOrg1, 'org-1')).toBe(true);
    expect(deepIncludesValue(whereForOrg1, 'org-2')).toBe(false);
    expect(deepIncludesValue(whereForOrg2, 'org-2')).toBe(true);
    expect(deepIncludesValue(whereForOrg2, 'org-1')).toBe(false);
  });

  it('enqueues a resume job for each claimed workflow-kind approval, keyed by its own targetId', async () => {
    seedUpdateReturning([
      { id: 'apr-w1', kind: 'workflow', targetId: 'run-1' },
      { id: 'apr-w2', kind: 'workflow', targetId: 'run-2' },
    ]);

    await controller.batchDecide('org-1', USER, {
      ids: ['apr-w1', 'apr-w2'],
      decision: 'approve',
    });

    expect(resumeQueueAdd).toHaveBeenCalledTimes(2);
    expect(resumeQueueAdd).toHaveBeenNthCalledWith(
      1,
      'resume',
      { orgId: 'org-1', runId: 'run-1', approved: true },
      expect.objectContaining({ attempts: 3 }),
    );
    expect(resumeQueueAdd).toHaveBeenNthCalledWith(
      2,
      'resume',
      { orgId: 'org-1', runId: 'run-2', approved: true },
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('does NOT enqueue a resume job for a non-workflow approval', async () => {
    seedUpdateReturning([{ id: 'apr-1', kind: 'content', targetId: 'item-1' }]);

    await controller.batchDecide('org-1', USER, { ids: ['apr-1'], decision: 'approve' });

    expect(resumeQueueAdd).not.toHaveBeenCalled();
  });

  it('passes `approved: false` to the resume job on a reject decision', async () => {
    seedUpdateReturning([{ id: 'apr-w3', kind: 'workflow', targetId: 'run-3' }]);

    await controller.batchDecide('org-1', USER, { ids: ['apr-w3'], decision: 'reject' });

    expect(resumeQueueAdd).toHaveBeenCalledWith(
      'resume',
      { orgId: 'org-1', runId: 'run-3', approved: false },
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('returns an empty `decided` (never an error) when every requested id was skipped', async () => {
    seedUpdateReturning([]);

    const result = expectSuccess(
      await controller.batchDecide('org-1', USER, {
        ids: ['apr-already-decided', 'apr-other-org'],
        decision: 'approve',
      }),
    );

    expect(result).toEqual({ decided: [] });
    expect(resumeQueueAdd).not.toHaveBeenCalled();
  });
});

describe('batchDecideSchema (Zod)', () => {
  const VALID_ID = '00000000-0000-0000-0000-000000000001';

  it('rejects an empty ids array', () => {
    expect(batchDecideSchema.safeParse({ ids: [], decision: 'approve' }).success).toBe(false);
  });

  it('rejects an array over the 100-id max', () => {
    const ids = Array.from(
      { length: 101 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );
    expect(batchDecideSchema.safeParse({ ids, decision: 'approve' }).success).toBe(false);
  });

  it('accepts exactly 100 ids (the max)', () => {
    const ids = Array.from(
      { length: 100 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );
    expect(batchDecideSchema.safeParse({ ids, decision: 'approve' }).success).toBe(true);
  });

  it('rejects a non-uuid id', () => {
    expect(
      batchDecideSchema.safeParse({ ids: ['not-a-uuid'], decision: 'approve' }).success,
    ).toBe(false);
  });

  it('rejects a decision outside approve/reject', () => {
    expect(
      batchDecideSchema.safeParse({ ids: [VALID_ID], decision: 'delete' }).success,
    ).toBe(false);
  });

  it('accepts a well-formed body', () => {
    expect(
      batchDecideSchema.safeParse({ ids: [VALID_ID], decision: 'reject' }).success,
    ).toBe(true);
  });
});

/**
 * Drives the real `ZodValidationPipe` + `BatchDecideBody` metatype pairing —
 * the same integration point Nest uses at request time — mirroring
 * `conversations.controller.spec.ts`'s approach for `ReplyBody`.
 */
describe('BatchDecideBody validation (via the real ZodValidationPipe)', () => {
  const metadata: ArgumentMetadata = { type: 'body', metatype: BatchDecideBody, data: undefined };

  function parseBatchBody(body: unknown): unknown {
    return new ZodValidationPipe().transform(body, metadata);
  }

  it('rejects an empty ids array as a validation_error (422)', () => {
    expect(() => parseBatchBody({ ids: [], decision: 'approve' })).toThrow(
      expect.objectContaining({ code: 'validation_error', statusCode: 422 }),
    );
  });

  it('rejects an oversized ids array as a validation_error', () => {
    const ids = Array.from(
      { length: 101 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );
    expect(() => parseBatchBody({ ids, decision: 'approve' })).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('accepts a well-formed body and passes it through unchanged', () => {
    const body = { ids: ['00000000-0000-0000-0000-000000000001'], decision: 'approve' };
    expect(parseBatchBody(body)).toEqual(body);
  });
});
