import { describe, expect, it } from 'vitest';
import type { Database } from '@brandpilot/db';
import {
  DEFAULT_DAILY_POSTS,
  DEFAULT_MONTHLY_BUDGET,
  DEFAULT_MAX_QUOTE_VALUE,
} from '@brandpilot/config';
import {
  toWebAutonomy,
  fromWebAutonomy,
  confidenceToPercent,
  toNumber,
  percentDelta,
  toWebContentStatus,
  toWebApprovalKind,
  resolveCaps,
  buildChannelList,
  loadQuoteApprovalValues,
  DISPLAY_CHANNELS,
} from './read-model.mappers';

/**
 * Pure read-model mappers run on every dashboard/approvals/leads response, and
 * the autonomy pair round-trips a safety-sensitive setting between the web's
 * tri-state and the canonical enum. These lock in that mapping + the numeric
 * coercion/guards for Drizzle `numeric` (string) columns.
 */

describe('autonomy mapping', () => {
  it('maps web tri-state → canonical (auto → conservative auto_scoped)', () => {
    expect(fromWebAutonomy('observe')).toBe('observe');
    expect(fromWebAutonomy('suggest')).toBe('suggest');
    expect(fromWebAutonomy('auto')).toBe('auto_scoped');
    expect(fromWebAutonomy('auto_scoped')).toBe('auto_scoped');
    expect(fromWebAutonomy('auto_broad')).toBe('auto_broad');
    expect(fromWebAutonomy('nonsense')).toBe('suggest'); // conservative default
  });

  it('collapses canonical → web, defaulting unknown to suggest (never fail-open to auto)', () => {
    expect(toWebAutonomy('observe')).toBe('observe');
    expect(toWebAutonomy('suggest')).toBe('suggest');
    expect(toWebAutonomy('auto_scoped')).toBe('auto');
    expect(toWebAutonomy('auto_broad')).toBe('auto');
    expect(toWebAutonomy(null)).toBe('suggest');
    expect(toWebAutonomy('weird')).toBe('suggest');
  });
});

describe('confidenceToPercent', () => {
  it('scales a 0..1 numeric to a 0..100 integer', () => {
    expect(confidenceToPercent(0.94)).toBe(94);
    expect(confidenceToPercent('0.5')).toBe(50);
  });

  it('passes through already-0..100 values and clamps out-of-range', () => {
    expect(confidenceToPercent(87)).toBe(87);
    expect(confidenceToPercent(150)).toBe(100);
    expect(confidenceToPercent(-5)).toBe(0);
  });

  it('defaults null / NaN to 0', () => {
    expect(confidenceToPercent(null)).toBe(0);
    expect(confidenceToPercent(undefined)).toBe(0);
    expect(confidenceToPercent('not-a-number')).toBe(0);
  });
});

describe('toNumber', () => {
  it('coerces Drizzle numeric strings; defaults junk to 0', () => {
    expect(toNumber('2400.00')).toBe(2400);
    expect(toNumber(42)).toBe(42);
    expect(toNumber(null)).toBe(0);
    expect(toNumber('abc')).toBe(0);
  });
});

describe('percentDelta', () => {
  it('computes a one-decimal delta and guards divide-by-zero', () => {
    expect(percentDelta(120, 100)).toBe(20);
    expect(percentDelta(90, 100)).toBe(-10);
    expect(percentDelta(50, 0)).toBe(0); // no prior → 0, not Infinity
  });
});

describe('web status/kind mappers default safely', () => {
  it('unknown content status → draft, unknown approval kind → content', () => {
    expect(toWebContentStatus('published')).toBe('published');
    expect(toWebContentStatus('mystery')).toBe('draft');
    expect(toWebApprovalKind('quote')).toBe('quote');
    expect(toWebApprovalKind('mystery')).toBe('content');
  });
});

describe('resolveCaps', () => {
  const defaults = {
    dailyPosts: DEFAULT_DAILY_POSTS,
    monthlyBudget: DEFAULT_MONTHLY_BUDGET,
    maxQuoteValue: DEFAULT_MAX_QUOTE_VALUE,
  };

  it('returns free-plan defaults (== legacy system defaults) for empty / null / malformed settings blobs', () => {
    expect(resolveCaps('free', {})).toEqual(defaults);
    expect(resolveCaps('free', null)).toEqual(defaults);
    expect(resolveCaps('free', undefined)).toEqual(defaults);
    expect(resolveCaps('free', 'nope')).toEqual(defaults);
    expect(resolveCaps('free', { caps: null })).toEqual(defaults);
    expect(resolveCaps('free', { caps: 'x' })).toEqual(defaults);
  });

  it('honors valid per-org overrides', () => {
    expect(
      resolveCaps('free', { caps: { dailyPosts: 10, monthlyBudget: 9000, maxQuoteValue: 25000 } }),
    ).toEqual({ dailyPosts: 10, monthlyBudget: 9000, maxQuoteValue: 25000 });
  });

  it('respects a 0 override (most restrictive; never fails open to the default)', () => {
    expect(
      resolveCaps('free', { caps: { dailyPosts: 0, monthlyBudget: 0, maxQuoteValue: 0 } }),
    ).toEqual({ dailyPosts: 0, monthlyBudget: 0, maxQuoteValue: 0 });
  });

  it('falls back to defaults for negative / NaN / non-numeric fields, merging partial overrides', () => {
    expect(
      resolveCaps('free', { caps: { dailyPosts: -3, monthlyBudget: Number.NaN, maxQuoteValue: '5000' } }),
    ).toEqual(defaults);
    expect(resolveCaps('free', { caps: { monthlyBudget: 2500 } })).toEqual({
      ...defaults,
      monthlyBudget: 2500,
    });
  });

  it('resolves higher ceilings for starter/pro plans', () => {
    expect(resolveCaps('starter', {})).toEqual({
      dailyPosts: 10,
      monthlyBudget: 5000,
      maxQuoteValue: 15000,
    });
    expect(resolveCaps('pro', {})).toEqual({
      dailyPosts: 30,
      monthlyBudget: 15000,
      maxQuoteValue: 50000,
    });
  });
});

describe('buildChannelList', () => {
  it('returns every displayed provider as disconnected when there are no accounts', () => {
    const list = buildChannelList([]);
    expect(list.map((c) => c.provider)).toEqual([...DISPLAY_CHANNELS]);
    expect(
      list.every(
        (c) => c.status === 'disconnected' && c.handle === null && c.connectedAt === null,
      ),
    ).toBe(true);
  });

  it('maps a connected account and coerces a Date connectedAt to ISO', () => {
    const list = buildChannelList([
      {
        provider: 'instagram',
        handle: '@lumina',
        status: 'connected',
        connectedAt: new Date('2026-06-14T10:00:00.000Z'),
      },
    ]);
    expect(list.find((c) => c.provider === 'instagram')).toEqual({
      provider: 'instagram',
      status: 'connected',
      handle: '@lumina',
      connectedAt: '2026-06-14T10:00:00.000Z',
    });
  });

  it('maps google_business → google and non-connected statuses → error', () => {
    const g = buildChannelList([
      { provider: 'google_business', handle: 'Lumina', status: 'expired', connectedAt: null },
    ]).find((c) => c.provider === 'google');
    expect(g).toMatchObject({ status: 'error', handle: 'Lumina' });
  });

  it('ignores providers the grid does not surface (whatsapp, linkedin)', () => {
    const list = buildChannelList([
      { provider: 'whatsapp', handle: '+123', status: 'connected', connectedAt: null },
      { provider: 'linkedin', handle: 'co', status: 'connected', connectedAt: null },
    ]);
    expect(list.every((c) => c.status === 'disconnected')).toBe(true);
  });

  it('prefers a healthy connected row over an errored one for the same provider', () => {
    const fb = buildChannelList([
      { provider: 'facebook', handle: 'errored', status: 'error', connectedAt: null },
      { provider: 'facebook', handle: 'good', status: 'connected', connectedAt: null },
    ]).find((c) => c.provider === 'facebook');
    expect(fb).toMatchObject({ status: 'connected', handle: 'good' });
  });
});

/**
 * Fake `tx.select({id, total}).from(quotes).where(cond)` for
 * {@link loadQuoteApprovalValues}: a chainable, thenable builder (mirrors the
 * fake used by `content.controller.spec.ts`) that resolves to `rows` and
 * records every `.where(...)` condition + how many times `.select()` itself
 * was called, so a test can assert the query is org-scoped and never N+1.
 */
function fakeQuotesTx(rows: ReadonlyArray<{ id: string; total: string | null }>): {
  db: Database;
  whereCalls: unknown[];
  // A mutable box, not a bare number: destructuring a primitive snapshots its
  // value at call time, so a plain `count: number` return would never reflect
  // later `.select()` calls made through `db` after this function returns.
  selectCalls: { count: number };
} {
  const whereCalls: unknown[] = [];
  const selectCalls = { count: 0 };
  const builder = {
    from: () => builder,
    where: (condition: unknown) => {
      whereCalls.push(condition);
      return builder;
    },
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  const db = {
    select: () => {
      selectCalls.count += 1;
      return builder;
    },
  } as unknown as Database;
  return { db, whereCalls, selectCalls };
}

/** Deep-search an object graph's own enumerable properties for a string value (finds a bound param buried in a drizzle condition tree). */
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

describe('loadQuoteApprovalValues', () => {
  it('returns an empty map and never queries the database when no row is a quote approval', async () => {
    const { db, selectCalls } = fakeQuotesTx([]);
    const result = await loadQuoteApprovalValues(db, 'org-1', [
      { id: 'approval-1', targetType: 'content_item', targetId: 'item-1' },
    ]);
    expect(result.size).toBe(0);
    expect(selectCalls.count).toBe(0);
  });

  it('batches every quote approval on the page into ONE query, keyed by approval id (never N+1)', async () => {
    const { db, whereCalls, selectCalls } = fakeQuotesTx([
      { id: 'quote-1', total: '499.99' },
      { id: 'quote-2', total: '1200' },
    ]);

    const result = await loadQuoteApprovalValues(db, 'org-1', [
      { id: 'approval-1', targetType: 'quote', targetId: 'quote-1' },
      { id: 'approval-2', targetType: 'content_item', targetId: 'item-1' },
      { id: 'approval-3', targetType: 'quote', targetId: 'quote-2' },
    ]);

    expect(selectCalls.count).toBe(1);
    expect(result.get('approval-1')).toBe(499.99);
    expect(result.get('approval-3')).toBe(1200);
    expect(result.has('approval-2')).toBe(false); // non-quote row is never looked up
    expect(whereCalls).toHaveLength(1);
    expect(deepIncludesValue(whereCalls[0], 'org-1')).toBe(true); // org-scoped, like every sibling query
  });

  it('omits an approval whose quote row no longer matches (deleted, or belongs to another org)', async () => {
    const { db } = fakeQuotesTx([]); // the quote query returns nothing
    const result = await loadQuoteApprovalValues(db, 'org-1', [
      { id: 'approval-1', targetType: 'quote', targetId: 'missing-quote' },
    ]);
    expect(result.size).toBe(0);
  });
});
