import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse } from '@brandpilot/core';

/**
 * `ContentController.list()` tests for the creative-media join (contentItem →
 * creativeJobs → creativeAssets).
 *
 * `withOrgScope` is stubbed to run the handler's callback against a fake `tx`
 * whose `.select(...)` returns a chainable, thenable query builder: every
 * chain method (`.from/.innerJoin/.leftJoin/.where/.orderBy/.limit/.offset`)
 * returns the same builder, and `await`-ing it resolves to the next fixture
 * pulled off an ordered queue (`seedRows`). This mirrors `list()`'s fixed,
 * SEQUENTIAL query order — count, items, variants, approvals, media (see the
 * handler) — so each test seeds fixtures in that exact order. The builder is
 * intentionally duck-typed (`any`) since it exists only to satisfy whatever
 * chain shape the handler calls next, not to type-check against drizzle's API.
 *
 * `.where(...)` calls are additionally recorded in call order in
 * `state.whereCalls`, so the media query's (5th call, index 4) actual filter
 * condition can be inspected structurally — the only way to pin org-scoping
 * without a real database, since this fake never evaluates predicates itself.
 */
const { state } = vi.hoisted(() => ({
  state: {
    rowsQueue: [] as unknown[][],
    whereCalls: [] as unknown[],
  },
}));

vi.mock('@brandpilot/db', async (importActual) => {
  const actual = await importActual<typeof import('@brandpilot/db')>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duck-typed fake query builder;
  // methods have deliberately different signatures (`.where` vs `.then`), which a
  // uniformly-typed record can't express without fighting function-variance checks.
  function chain(): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
    const builder: any = {};
    const self = () => builder;
    builder.from = self;
    builder.innerJoin = self;
    builder.leftJoin = self;
    builder.orderBy = self;
    builder.limit = self;
    builder.offset = self;
    builder.where = (condition: unknown) => {
      state.whereCalls.push(condition);
      return builder;
    };
    builder.then = (resolve: (rows: unknown[]) => void, reject?: (err: unknown) => void) =>
      Promise.resolve(state.rowsQueue.shift() ?? []).then(resolve, reject);
    return builder;
  }

  const tx = { select: () => chain() };

  return {
    ...actual,
    withOrgScope: (_db: unknown, _orgId: string, cb: (t: unknown) => unknown) => cb(tx),
  };
});

import { ContentController } from './content.controller';

/** Seed the fake tx's per-`select()` fixture queue, in call order. */
function seedRows(...rowSets: unknown[][]): void {
  state.rowsQueue = [...rowSets];
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

/** Deep-search an object graph's own enumerable properties for a string value. */
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

function makeItemRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'item-1',
    format: 'post',
    brief: 'A brief',
    pillar: 'Skincare',
    status: 'draft',
    scheduledFor: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('ContentController.list — creative media join', () => {
  let controller: ContentController;

  beforeEach(() => {
    state.rowsQueue = [];
    state.whereCalls = [];
    controller = new ContentController({} as never, { add: vi.fn() } as never);
  });

  it('attaches media for an item with a done creative asset, deriving url/kind/aspect/alt from the row', async () => {
    seedRows(
      [{ value: 1 }], // count
      [makeItemRow({ id: 'item-1' })], // itemRows
      [], // variantRows
      [], // approvalRows
      [
        {
          contentItemId: 'item-1',
          jobKind: 'image',
          jobPrompt: { imagePrompt: 'a bright skincare flat-lay', altText: 'A bright skincare flat-lay' },
          storageKey: 'https://fal.media/files/abc/image.png',
          mime: 'image/png',
          width: 1080,
          height: 1350,
          durationMs: null,
          assetMeta: {},
        },
      ], // mediaRows
    );

    const data = expectSuccess(await controller.list('org-1', { page: 1, limit: 20 }));

    expect(data.items).toHaveLength(1);
    expect(data.items[0]?.media).toEqual({
      url: 'https://fal.media/files/abc/image.png',
      kind: 'image',
      alt: 'A bright skincare flat-lay',
      aspect: 'portrait',
    });
  });

  it('derives kind "video" from the job kind and falls back to a generated alt when none is stored', async () => {
    seedRows(
      [{ value: 1 }],
      [makeItemRow({ id: 'item-2', format: 'reel', brief: null, pillar: null })],
      [],
      [],
      [
        {
          contentItemId: 'item-2',
          jobKind: 'video',
          jobPrompt: {},
          storageKey: 'https://fal.media/files/def/video.mp4',
          mime: null,
          width: null,
          height: null,
          durationMs: null,
          assetMeta: {},
        },
      ],
    );

    const data = expectSuccess(await controller.list('org-1', { page: 1, limit: 20 }));

    expect(data.items[0]?.media).toEqual({
      url: 'https://fal.media/files/def/video.mp4',
      kind: 'video',
      alt: 'Generated video for “reel content”',
      aspect: 'square',
    });
  });

  it('picks the most recent `done` asset when an item has more than one', async () => {
    seedRows(
      [{ value: 1 }],
      [makeItemRow({ id: 'item-5' })],
      [],
      [],
      [
        // Newest first, matching the handler's `orderBy(desc(creativeAssets.createdAt))`.
        {
          contentItemId: 'item-5',
          jobKind: 'image',
          jobPrompt: {},
          storageKey: 'https://fal.media/files/newest.png',
          mime: 'image/png',
          width: 100,
          height: 100,
          durationMs: null,
          assetMeta: { altText: 'Newest render' },
        },
        {
          contentItemId: 'item-5',
          jobKind: 'image',
          jobPrompt: {},
          storageKey: 'https://fal.media/files/older.png',
          mime: 'image/png',
          width: 100,
          height: 100,
          durationMs: null,
          assetMeta: { altText: 'Older render' },
        },
      ],
    );

    const data = expectSuccess(await controller.list('org-1', { page: 1, limit: 20 }));

    expect(data.items[0]?.media?.url).toBe('https://fal.media/files/newest.png');
    expect(data.items[0]?.media?.alt).toBe('Newest render');
  });

  it('omits `media` entirely (not `media: undefined`) for an item with no creative asset', async () => {
    seedRows([{ value: 1 }], [makeItemRow({ id: 'item-3' })], [], [], []);

    const data = expectSuccess(await controller.list('org-1', { page: 1, limit: 20 }));

    const item = data.items[0];
    expect(item?.media).toBeUndefined();
    expect(item && 'media' in item).toBe(false);
  });

  it("scopes the media query's where-clause to the caller's own org id (never another org's asset)", async () => {
    seedRows([{ value: 1 }], [makeItemRow({ id: 'item-4' })], [], [], []);
    await controller.list('org-1', { page: 1, limit: 20 });
    const whereForOrg1 = state.whereCalls[4];

    state.whereCalls = [];
    seedRows([{ value: 1 }], [makeItemRow({ id: 'item-4' })], [], [], []);
    await controller.list('org-2', { page: 1, limit: 20 });
    const whereForOrg2 = state.whereCalls[4];

    expect(deepIncludesValue(whereForOrg1, 'org-1')).toBe(true);
    expect(deepIncludesValue(whereForOrg1, 'org-2')).toBe(false);
    expect(deepIncludesValue(whereForOrg2, 'org-2')).toBe(true);
    expect(deepIncludesValue(whereForOrg2, 'org-1')).toBe(false);
    // Also pins the `done`-only filter (queued/rendering/failed jobs never surface).
    expect(deepIncludesValue(whereForOrg1, 'done')).toBe(true);
  });
});
