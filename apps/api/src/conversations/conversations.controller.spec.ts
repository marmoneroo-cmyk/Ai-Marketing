import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArgumentMetadata } from '@nestjs/common';
import type { ApiResponse } from '@brandpilot/core';

/**
 * `ConversationsController.reply()` tests for the human-reply write path (the
 * fix for the `needs_human` dead end: a conversation could be escalated to a
 * human with no way to actually respond).
 *
 * `withOrgScope` is stubbed to run the callback against a fake `tx` whose
 * `.select()/.insert()/.update()` return chainable, thenable query builders —
 * mirrors the idiom in `approvals.controller.spec.ts`. Calls happen in a fixed
 * order inside `reply()`: SELECT (org-scoped existence check), INSERT (the
 * message, `.returning()`), an UNCONDITIONAL UPDATE (bumps `lastMessageAt`),
 * then a CONDITIONAL UPDATE (flips `status`, guarded by `inArray` in its WHERE
 * — see the controller's comment on why that guard is load-bearing, not just
 * belt-and-suspenders: `withOrgScope`'s transaction is plain READ COMMITTED,
 * so a concurrent status change between this handler's SELECT and its second
 * UPDATE is possible, and the WHERE-level guard is what actually prevents a
 * clobber, not the earlier `existing.status` check alone). `inArray` itself is
 * partially mocked (real behavior preserved) purely to capture the exact
 * status list it was called with, so that guard's content is asserted
 * directly rather than inferred from an un-simulated fake WHERE filter.
 */
const { state, logger } = vi.hoisted(() => ({
  state: {
    selectQueue: [] as unknown[][],
    insertQueue: [] as unknown[][],
    updateCalls: [] as Array<{ set: unknown }>,
    inArrayCalls: [] as unknown[][],
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@brandpilot/observability', () => ({ logger }));

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
  function selectChain(): any {
    const builder: any = {};
    const self = () => builder;
    builder.from = self;
    builder.where = self;
    builder.orderBy = self;
    builder.limit = self;
    builder.then = (resolve: (rows: unknown[]) => void, reject?: (err: unknown) => void) =>
      Promise.resolve(state.selectQueue.shift() ?? []).then(resolve, reject);
    return builder;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duck-typed fake query builder
  function insertChain(): any {
    const builder: any = {};
    builder.values = () => builder;
    builder.returning = () => Promise.resolve(state.insertQueue.shift() ?? []);
    return builder;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duck-typed fake query builder
  function updateChain(): any {
    const builder: any = {};
    let pendingSet: unknown;
    builder.set = (setValues: unknown) => {
      pendingSet = setValues;
      return builder;
    };
    builder.where = () => {
      state.updateCalls.push({ set: pendingSet });
      return Promise.resolve(undefined);
    };
    return builder;
  }

  const tx = {
    select: () => selectChain(),
    insert: () => insertChain(),
    update: () => updateChain(),
  };

  return {
    ...actual,
    withOrgScope: (_db: unknown, _orgId: string, cb: (t: unknown) => unknown) => cb(tx),
  };
});

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ConversationsController, ReplyBody, replySchema } from './conversations.controller';

/** Seed the fake tx's select/insert fixture queues, in call order. */
function seed(opts: { existing?: unknown[]; inserted?: unknown[] }): void {
  state.selectQueue = opts.existing !== undefined ? [opts.existing] : [];
  state.insertQueue = opts.inserted !== undefined ? [opts.inserted] : [];
  state.updateCalls = [];
  state.inArrayCalls = [];
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

const INSERTED_MESSAGE = {
  id: 'msg-new',
  direction: 'outbound',
  authorType: 'human',
  body: 'Yes, 2:30pm works — see you then!',
  createdAt: new Date('2026-07-11T10:05:00Z'),
};

describe('ConversationsController.reply', () => {
  let controller: ConversationsController;

  beforeEach(() => {
    state.selectQueue = [];
    state.insertQueue = [];
    state.updateCalls = [];
    state.inArrayCalls = [];
    logger.info.mockReset();
    controller = new ConversationsController({} as never);
  });

  it('inserts an outbound human message, bumps lastMessageAt, and flips status to closed when the thread was needs_human', async () => {
    seed({
      existing: [{ id: 'conv-1', status: 'needs_human' }],
      inserted: [INSERTED_MESSAGE],
    });

    const result = expectSuccess(
      await controller.reply('org-1', 'conv-1', { body: 'Yes, 2:30pm works — see you then!' } as never),
    );

    expect(result).toEqual({
      id: 'msg-new',
      direction: 'outbound',
      author: 'human',
      body: 'Yes, 2:30pm works — see you then!',
      createdAt: '2026-07-11T10:05:00.000Z',
    });

    // Two updates: the unconditional lastMessageAt bump, then the status flip.
    expect(state.updateCalls).toHaveLength(2);
    expect(state.updateCalls[0]?.set).toMatchObject({ lastMessageAt: expect.any(Date) });
    expect(state.updateCalls[1]?.set).toMatchObject({ status: 'closed' });

    // The status flip's WHERE guards on exactly this status set — the atomic
    // guarantee against a concurrent status change (see file-header comment).
    expect(state.inArrayCalls).toEqual([['open', 'needs_human']]);

    expect(logger.info).toHaveBeenCalledWith(
      { orgId: 'org-1', conversationId: 'conv-1' },
      'human reply recorded',
    );
  });

  it('also flips an open (not yet escalated) thread to closed', async () => {
    seed({
      existing: [{ id: 'conv-2', status: 'open' }],
      inserted: [{ ...INSERTED_MESSAGE, id: 'msg-2' }],
    });

    await controller.reply('org-1', 'conv-2', { body: 'On it!' } as never);

    expect(state.updateCalls).toHaveLength(2);
    expect(state.updateCalls[1]?.set).toMatchObject({ status: 'closed' });
  });

  it('does NOT clobber a conversation the AI is actively handling — the reply is still recorded and lastMessageAt still bumps', async () => {
    seed({
      existing: [{ id: 'conv-3', status: 'ai_handling' }],
      inserted: [{ ...INSERTED_MESSAGE, id: 'msg-3' }],
    });

    await controller.reply('org-1', 'conv-3', { body: 'Jumping in here' } as never);

    // Only the unconditional lastMessageAt bump ran; no status-changing update.
    expect(state.updateCalls).toHaveLength(1);
    expect(state.updateCalls[0]?.set).toMatchObject({ lastMessageAt: expect.any(Date) });
    expect(state.updateCalls[0]?.set).not.toHaveProperty('status');
    expect(state.inArrayCalls).toHaveLength(0);
  });

  it('does NOT clobber an already-closed conversation', async () => {
    seed({
      existing: [{ id: 'conv-4', status: 'closed' }],
      inserted: [{ ...INSERTED_MESSAGE, id: 'msg-4' }],
    });

    await controller.reply('org-1', 'conv-4', { body: 'Following up' } as never);

    expect(state.updateCalls).toHaveLength(1);
    expect(state.updateCalls[0]?.set).not.toHaveProperty('status');
  });

  it('is org-scoped: a conversation from another org 404s and never writes', async () => {
    seed({ existing: [] }); // no row matches (org, id) — cross-tenant or nonexistent

    await expect(
      controller.reply('org-1', 'someone-elses-conv', { body: 'Hello?' } as never),
    ).rejects.toMatchObject({ code: 'not_found' });

    // No insert fixture was queued and none should have been consumed —
    // asserting the queue is untouched proves the write never happened.
    expect(state.insertQueue).toHaveLength(0);
    expect(state.updateCalls).toHaveLength(0);
  });

  it('rejects an empty body via the Zod schema', () => {
    const result = replySchema.safeParse({ body: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a body over 4000 characters via the Zod schema', () => {
    const result = replySchema.safeParse({ body: 'x'.repeat(4001) });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed body via the Zod schema', () => {
    const result = replySchema.safeParse({ body: 'Sounds good, see you Saturday!' });
    expect(result.success).toBe(true);
  });
});

/**
 * Drives the real `ZodValidationPipe` + `ReplyBody` metatype pairing — the
 * same integration point Nest uses at request time — mirroring
 * `auth.controller.spec.ts`'s approach for `RegisterBody`.
 */
describe('ReplyBody validation (via the real ZodValidationPipe)', () => {
  const metadata: ArgumentMetadata = { type: 'body', metatype: ReplyBody, data: undefined };

  function parseReplyBody(body: unknown): unknown {
    return new ZodValidationPipe().transform(body, metadata);
  }

  it('rejects an empty body as a validation_error (422)', () => {
    expect(() => parseReplyBody({ body: '' })).toThrow(
      expect.objectContaining({ code: 'validation_error', statusCode: 422 }),
    );
  });

  it('rejects a missing body field', () => {
    expect(() => parseReplyBody({})).toThrow(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('accepts a well-formed body and passes it through unchanged', () => {
    expect(parseReplyBody({ body: 'See you Saturday at 2:30!' })).toEqual({
      body: 'See you Saturday at 2:30!',
    });
  });
});
