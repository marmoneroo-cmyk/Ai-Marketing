import { describe, expect, it, vi } from 'vitest';
import { leads, contacts, type Database } from '@brandpilot/db';
import type { BusinessBrain } from '@brandpilot/business-brain';
import type { AgentRuntime, AgentRunInput, AgentRunResult } from '@brandpilot/agent-runtime';
import { SalesEngine } from './sales-engine';

/**
 * Behavioral tests for SalesEngine.qualifyLead — specifically that lead-fit
 * scoring is grounded in the business's ICP (personas) and offering catalogue
 * (services/products) instead of only the lead's own fields. Every dependency
 * is a deterministic in-memory fake — no network, no DB.
 */

const ORG_ID = 'org_1';
const LEAD_ID = 'lead_1';

/** Fake db exposing only the `leads`/`contacts` selects and the `leads` update qualifyLead uses. */
function makeFakeDb(opts: { lead?: Record<string, unknown>; contact?: Record<string, unknown> }): {
  db: Database;
  updateCalls: Array<{ table: unknown; values: unknown }>;
} {
  const updateCalls: Array<{ table: unknown; values: unknown }> = [];
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              table === leads && opts.lead
                ? [opts.lead]
                : table === contacts && opts.contact
                  ? [opts.contact]
                  : [],
            ),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => {
          updateCalls.push({ table, values });
          return Promise.resolve([]);
        },
      }),
    }),
  } as unknown as Database;
  return { db, updateCalls };
}

interface FakeBrainOptions {
  personas?: Array<{ name: string }>;
  services?: Array<{ name: string }>;
  products?: Array<{ name: string }>;
}

function makeFakeBrain(opts: FakeBrainOptions = {}): {
  brain: BusinessBrain;
  recordSignal: ReturnType<typeof vi.fn>;
} {
  const recordSignal = vi.fn(async () => {});
  const brain = {
    facts: {
      listPersonas: vi.fn(async () => opts.personas ?? []),
      listServices: vi.fn(async () => opts.services ?? []),
      listProducts: vi.fn(async () => opts.products ?? []),
    },
    recordSignal,
  } as unknown as BusinessBrain;
  return { brain, recordSignal };
}

/** Fake AgentRuntime capturing the exact input it was run with. */
function makeFakeRuntime(output: { score: number; reasoning: string }): {
  runtime: AgentRuntime;
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(
    async (): Promise<AgentRunResult> => ({
      output: JSON.stringify(output),
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

describe('SalesEngine.qualifyLead', () => {
  it('grounds lead-fit scoring with a groundingQuery and the ICP personas + offering catalogue', async () => {
    // Arrange
    const lead = { id: LEAD_ID, orgId: ORG_ID, contactId: null, source: 'form', status: 'new' };
    const { db } = makeFakeDb({ lead });
    const { brain } = makeFakeBrain({
      personas: [{ name: 'Busy Parent' }],
      services: [{ name: 'Haircut' }],
      products: [{ name: 'Shampoo' }],
    });
    const { runtime, run } = makeFakeRuntime({ score: 0.8, reasoning: 'good fit' });
    const engine = new SalesEngine({ db, brain, runtime });

    // Act
    await engine.qualifyLead(ORG_ID, LEAD_ID);

    // Assert — the runtime call carries a real groundingQuery (never skippable
    // grounding for lead-fit) and the prompt is grounded in personas + offerings.
    expect(run).toHaveBeenCalledTimes(1);
    const input = run.mock.calls[0]?.[0] as AgentRunInput;
    expect(input.groundingQuery).toBeTruthy();
    expect(typeof input.groundingQuery).toBe('string');
    expect(input.prompt).toContain('Busy Parent');
    expect(input.prompt).toContain('Haircut');
    expect(input.prompt).toContain('Shampoo');
  });

  it('still qualifies correctly (score + status) when the business has no personas/services/products yet', async () => {
    // Arrange
    const lead = { id: LEAD_ID, orgId: ORG_ID, contactId: null, source: 'form', status: 'new' };
    const { db, updateCalls } = makeFakeDb({ lead });
    const { brain } = makeFakeBrain();
    const { runtime } = makeFakeRuntime({ score: 0.9, reasoning: 'great fit' });
    const engine = new SalesEngine({ db, brain, runtime });

    // Act
    const result = await engine.qualifyLead(ORG_ID, LEAD_ID);

    // Assert — graceful degradation: no offerings/personas yet must not throw.
    expect(result).toEqual({ score: 0.9, status: 'qualified' });
    expect(updateCalls).toHaveLength(1);
  });

  it('marks a low-scoring lead as nurturing rather than qualified', async () => {
    // Arrange
    const lead = { id: LEAD_ID, orgId: ORG_ID, contactId: null, source: 'form', status: 'new' };
    const { db } = makeFakeDb({ lead });
    const { brain } = makeFakeBrain();
    const { runtime } = makeFakeRuntime({ score: 0.2, reasoning: 'poor fit' });
    const engine = new SalesEngine({ db, brain, runtime });

    // Act
    const result = await engine.qualifyLead(ORG_ID, LEAD_ID);

    // Assert
    expect(result.status).toBe('nurturing');
  });

  it('throws when the lead does not exist', async () => {
    // Arrange
    const { db } = makeFakeDb({});
    const { brain } = makeFakeBrain();
    const { runtime, run } = makeFakeRuntime({ score: 0.5, reasoning: '' });
    const engine = new SalesEngine({ db, brain, runtime });

    // Act & Assert
    await expect(engine.qualifyLead(ORG_ID, 'missing')).rejects.toThrow(/not found/);
    expect(run).not.toHaveBeenCalled();
  });
});
