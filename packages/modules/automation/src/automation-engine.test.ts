import { describe, expect, it } from 'vitest';
import {
  workflows,
  workflowRuns,
  workflowStepRuns,
  approvals,
  type Database,
} from '@brandpilot/db';
import { AutomationEngine } from './automation-engine';
import type { ActionHandler, EngineSignal } from './types';

/**
 * Behavioural tests for the AutomationEngine orchestration core (runWorkflow →
 * executeFrom) — the code that runs every autonomous workflow. A fake Database
 * records step-run inserts, run-status updates, and approval inserts so we can
 * assert the three critical outcomes without a real DB:
 *   1. all steps succeed → run `done`, context threaded between steps
 *   2. a step's action has no handler → run `failed`
 *   3. an approval-gated step → run `waiting_approval`, gated action NOT executed
 */

interface WfFixture {
  id: string;
  orgId: string;
  name: string;
  trigger: unknown;
  definition: unknown;
  enabled: boolean;
}

interface Recorded {
  runId: string;
  wf: WfFixture;
  stepRuns: Array<{ stepKey: string; status: string; input?: Record<string, unknown> }>;
  runStatuses: string[];
  approvals: number;
  /**
   * workflow_runs rows "persisted" by insert. Backs the idempotent-signal-replay
   * test: runWorkflow's pre-check selects from this to simulate the
   * (workflowId, triggerSignalId) lookup a real unique index would serve.
   */
  insertedRuns: Array<{ id: string; workflowId: string; triggerSignalId?: string; status: string }>;
}

/** Minimal Drizzle-shaped fake covering the exact call chains runWorkflow uses. */
function fakeDb(rec: Recorded): Database {
  return {
    select: () => ({
      from: (table: unknown) => {
        // `workflows` → the fixture (runWorkflow's lookup); `workflowRuns` →
        // whatever's been "inserted" so far (runWorkflow's idempotency
        // pre-check); anything else → empty.
        const rows = table === workflows ? [rec.wf] : table === workflowRuns ? rec.insertedRuns : [];
        const builder = {
          where: () => builder,
          limit: () => Promise.resolve(rows.slice(0, 1)),
          orderBy: () => Promise.resolve(rows),
        };
        return builder;
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        if (table === workflowRuns) {
          const row = {
            id: rec.runId,
            workflowId: String(vals.workflowId),
            status: String(vals.status),
            ...(vals.triggerSignalId !== undefined
              ? { triggerSignalId: String(vals.triggerSignalId) }
              : {}),
          };
          rec.insertedRuns.push(row);
          const rows = [{ ...row, context: vals.context }];
          const resolved = Object.assign(Promise.resolve(rows), { returning: () => Promise.resolve(rows) });
          // Production always chains .onConflictDoNothing() before .returning();
          // this fake never simulates a real conflict (the pre-check above is
          // what the idempotency test exercises), so it's a transparent passthrough.
          return Object.assign(resolved, { onConflictDoNothing: () => resolved });
        }
        if (table === workflowStepRuns) {
          rec.stepRuns.push({
            stepKey: String(vals.stepKey),
            status: String(vals.status),
            ...(vals.input !== undefined ? { input: vals.input as Record<string, unknown> } : {}),
          });
        }
        if (table === approvals) rec.approvals += 1;
        return Object.assign(Promise.resolve([]), { returning: () => Promise.resolve([]) });
      },
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => {
        if (table === workflowRuns && typeof vals.status === 'string') {
          rec.runStatuses.push(vals.status);
        }
        const done = Object.assign(Promise.resolve([{ id: rec.runId }]), {
          returning: () => Promise.resolve([{ id: rec.runId }]),
        });
        return { where: () => done };
      },
    }),
  } as unknown as Database;
}

function baseRec(definition: unknown): Recorded {
  return {
    runId: 'run1',
    wf: { id: 'wf1', orgId: 'org1', name: 'W', trigger: {}, definition, enabled: true },
    stepRuns: [],
    runStatuses: [],
    approvals: 0,
    insertedRuns: [],
  };
}

describe('AutomationEngine.runWorkflow', () => {
  it('runs all steps to done, records success, and threads context between steps', async () => {
    const rec = baseRec({
      steps: [
        { key: 'a', action: 'act1' },
        { key: 'b', action: 'act2' },
      ],
    });
    const calls: Array<{ step: string; input: Record<string, unknown> }> = [];
    const actions: Record<string, ActionHandler> = {
      act1: async ({ input }) => {
        calls.push({ step: 'act1', input });
        return { leadId: 'L1' };
      },
      act2: async ({ input }) => {
        calls.push({ step: 'act2', input });
        return { done: true };
      },
    };
    const engine = new AutomationEngine({ db: fakeDb(rec), actions });

    const result = await engine.runWorkflow('org1', 'wf1', { contactId: 'C1' });

    expect(result.status).toBe('done');
    expect(rec.runStatuses).toContain('done');
    expect(rec.stepRuns.filter((s) => s.status === 'success').map((s) => s.stepKey)).toEqual([
      'a',
      'b',
    ]);
    // act1 sees the trigger payload; act2 sees the trigger payload + act1's threaded output.
    expect(calls[0]?.input).toMatchObject({ contactId: 'C1' });
    expect(calls[1]?.input).toMatchObject({ contactId: 'C1', leadId: 'L1' });
  });

  it('marks the run failed when a step action has no registered handler', async () => {
    const rec = baseRec({ steps: [{ key: 'a', action: 'missing' }] });
    const engine = new AutomationEngine({ db: fakeDb(rec), actions: {} });

    const result = await engine.runWorkflow('org1', 'wf1', {});

    expect(result.status).toBe('failed');
    expect(rec.runStatuses).toContain('failed');
    expect(rec.stepRuns.some((s) => s.status === 'error')).toBe(true);
  });

  it('halts at an approval-gated step (waiting_approval) without running the gated action', async () => {
    const rec = baseRec({ steps: [{ key: 'a', action: 'act1', requiresApproval: true }] });
    let ran = false;
    const actions: Record<string, ActionHandler> = {
      act1: async () => {
        ran = true;
        return {};
      },
    };
    const engine = new AutomationEngine({ db: fakeDb(rec), actions });

    const result = await engine.runWorkflow('org1', 'wf1', {});

    expect(result.status).toBe('waiting_approval');
    expect(rec.runStatuses).toContain('waiting_approval');
    expect(rec.approvals).toBe(1);
    expect(ran).toBe(false);
  });
});
