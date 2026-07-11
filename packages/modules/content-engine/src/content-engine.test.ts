import { describe, expect, it, vi } from 'vitest';
import { contentPlans, contentItems, contentVariants, type Database } from '@brandpilot/db';
import type { BusinessBrain } from '@brandpilot/business-brain';
import type { AgentRuntime, AgentRunResult } from '@brandpilot/agent-runtime';
import { ContentEngine } from './content-engine';

/**
 * Behavioral tests for ContentEngine's (org, week) plan idempotency — the fix
 * ensuring a retry / schedule-overlap never drafts a duplicate plan or a
 * duplicate batch of LLM-drafted variants. A small in-memory, table-keyed fake
 * db (dispatching on table identity, like BusinessBrain's own tests) stands in
 * for drizzle — no network, no real Postgres.
 */

const ORG_ID = 'org_1';
const WEEK_START = new Date('2026-01-05T00:00:00.000Z');
const PERIOD_START = '2026-01-05';

interface FakeRow {
  id: string;
  [key: string]: unknown;
}

interface Seed {
  contentPlans?: FakeRow[];
  contentItems?: FakeRow[];
  contentVariants?: FakeRow[];
}

function rowsFor(state: Required<Seed>, table: unknown): FakeRow[] {
  if (table === contentPlans) return state.contentPlans;
  if (table === contentItems) return state.contentItems;
  if (table === contentVariants) return state.contentVariants;
  return [];
}

function pushRows(state: Required<Seed>, table: unknown, rows: FakeRow[]): void {
  if (table === contentPlans) state.contentPlans.push(...rows);
  else if (table === contentItems) state.contentItems.push(...rows);
  else if (table === contentVariants) state.contentVariants.push(...rows);
}

/**
 * A minimal drizzle-shaped fake supporting exactly the chains ContentEngine
 * uses: `.where()` (bare-awaitable), `.where().limit()`, and
 * `.where().orderBy().limit()` for selects; `.values()` / `.values().returning()`
 * for inserts. Predicates are NOT evaluated (mirrors BusinessBrain's own
 * tests) — each test seeds only the rows relevant to its table, so returning
 * "every row for this table" is equivalent to a real WHERE for these fixtures.
 */
function makeFakeDb(seed: Seed = {}): { db: Database; insertedTables: unknown[] } {
  const state: Required<Seed> = {
    contentPlans: [...(seed.contentPlans ?? [])],
    contentItems: [...(seed.contentItems ?? [])],
    contentVariants: [...(seed.contentVariants ?? [])],
  };
  const insertedTables: unknown[] = [];
  let nextId = 100;

  function selectFrom(table: unknown) {
    const rows = rowsFor(state, table);
    const limited = (n: number) => Promise.resolve(rows.slice(0, n));
    return {
      where: () =>
        Object.assign(Promise.resolve(rows), {
          limit: limited,
          orderBy: () => Object.assign(Promise.resolve(rows), { limit: limited }),
        }),
    };
  }

  const db = {
    select: () => ({ from: selectFrom }),
    insert: (table: unknown) => ({
      values: (v: unknown) => {
        insertedTables.push(table);
        const rowsArr = (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
        const inserted = rowsArr.map((r) => ({ id: `new_${nextId++}`, ...r }));
        pushRows(state, table, inserted);
        return Object.assign(Promise.resolve(inserted), { returning: () => Promise.resolve(inserted) });
      },
    }),
  } as unknown as Database;

  return { db, insertedTables };
}

function makeFakeBrain(): { brain: BusinessBrain } {
  const brain = {
    getVoiceProfile: vi.fn(async () => null),
    facts: {
      listServices: vi.fn(async () => []),
      listProducts: vi.fn(async () => []),
      listPersonas: vi.fn(async () => []),
      listCompetitors: vi.fn(async () => []),
    },
    recordSignal: vi.fn(async () => {}),
  } as unknown as BusinessBrain;
  return { brain };
}

function makeFakeRuntime(plan: {
  pillars: string[];
  items: Array<{ format: string; pillar: string; brief: string }>;
}): { runtime: AgentRuntime; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(
    async (): Promise<AgentRunResult> => ({
      output: JSON.stringify(plan),
      rationale: 'ok',
      confidence: 0.9,
      citedChunkIds: [],
      model: 'm',
      outputTokens: 1,
    }),
  );
  const runtime = { run } as unknown as AgentRuntime;
  return { runtime, run };
}

describe('ContentEngine (org, week) plan idempotency', () => {
  describe('generateWeeklyPlan', () => {
    it('returns the existing plan — no insert, no LLM call — when one already exists for the org+period', async () => {
      // Arrange: a plan already exists for this org+period, with 2 items.
      const { db, insertedTables } = makeFakeDb({
        contentPlans: [{ id: 'plan_existing', orgId: ORG_ID, periodStart: PERIOD_START }],
        contentItems: [
          { id: 'item_1', orgId: ORG_ID, planId: 'plan_existing' },
          { id: 'item_2', orgId: ORG_ID, planId: 'plan_existing' },
        ],
      });
      const { brain } = makeFakeBrain();
      const { runtime, run } = makeFakeRuntime({ pillars: [], items: [] });
      const engine = new ContentEngine({ db, brain, runtime });

      // Act
      const result = await engine.generateWeeklyPlan(ORG_ID, WEEK_START);

      // Assert — the existing plan is returned verbatim; nothing is (re)drafted.
      expect(result).toEqual({ planId: 'plan_existing', itemCount: 2 });
      expect(run).not.toHaveBeenCalled();
      expect(insertedTables).toHaveLength(0);
    });

    it('drafts and inserts a new plan via the LLM when none exists for the org+period', async () => {
      // Arrange: no existing plan for this org+period.
      const { db, insertedTables } = makeFakeDb();
      const { brain } = makeFakeBrain();
      const { runtime, run } = makeFakeRuntime({
        pillars: ['education'],
        items: [
          { format: 'post', pillar: 'education', brief: 'tip 1' },
          { format: 'reel', pillar: 'education', brief: 'tip 2' },
        ],
      });
      const engine = new ContentEngine({ db, brain, runtime });

      // Act
      const result = await engine.generateWeeklyPlan(ORG_ID, WEEK_START);

      // Assert — the normal (non-idempotent) path still works after the refactor.
      expect(run).toHaveBeenCalledTimes(1);
      expect(result.planId).toBeTruthy();
      expect(result.itemCount).toBe(2);
      expect(insertedTables).toContain(contentPlans);
      expect(insertedTables).toContain(contentItems);
    });
  });

  describe('generateWeeklyPlanWithVariants', () => {
    it('returns the existing plan + variant counts — no LLM call at all — when a plan already exists for the org+period', async () => {
      // Arrange: existing plan, 2 items, 1 variant already drafted from a prior run.
      const { db, insertedTables } = makeFakeDb({
        contentPlans: [{ id: 'plan_existing', orgId: ORG_ID, periodStart: PERIOD_START }],
        contentItems: [
          { id: 'item_1', orgId: ORG_ID, planId: 'plan_existing' },
          { id: 'item_2', orgId: ORG_ID, planId: 'plan_existing' },
        ],
        contentVariants: [{ id: 'variant_1', contentItemId: 'item_1' }],
      });
      const { brain } = makeFakeBrain();
      const { runtime, run } = makeFakeRuntime({ pillars: [], items: [] });
      const engine = new ContentEngine({ db, brain, runtime });

      // Act
      const result = await engine.generateWeeklyPlanWithVariants(ORG_ID, WEEK_START);

      // Assert — no regeneration: zero LLM calls (neither planning nor variant
      // drafting), zero new inserts anywhere, existing counts reported back.
      expect(result).toEqual({
        planId: 'plan_existing',
        itemCount: 2,
        variantCount: 1,
        variantErrors: 0,
      });
      expect(run).not.toHaveBeenCalled();
      expect(insertedTables).toHaveLength(0);
    });
  });
});
