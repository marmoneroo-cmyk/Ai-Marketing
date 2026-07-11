import { describe, expect, it, vi } from 'vitest';
import { faqs, policies, objections, type Database } from '@brandpilot/db';
import { BusinessBrain } from './business-brain';
import type { Embedder } from './types';

/**
 * Behavioural tests for BusinessBrain.upsertKnowledge — specifically its
 * idempotent re-index contract. A fake Database records delete/insert calls and
 * a fake Embedder records embed calls, so we assert the real control flow
 * (embed-before-write, replace-by-externalRef) without a DB or network.
 */

interface Recorded {
  deletes: number;
  inserts: number;
  embedCalls: number;
}

function newRecord(): Recorded {
  return { deletes: 0, inserts: 0, embedCalls: 0 };
}

function makeBrain(rec: Recorded): BusinessBrain {
  const db = {
    delete: () => ({
      where: () => {
        rec.deletes += 1;
        return Promise.resolve([]);
      },
    }),
    insert: () => ({
      values: () => {
        rec.inserts += 1;
        return Object.assign(Promise.resolve([{ id: `id_${rec.inserts}` }]), {
          returning: () => Promise.resolve([{ id: `id_${rec.inserts}` }]),
        });
      },
    }),
  } as unknown as Database;

  const embedder = {
    embed: async (texts: string[]): Promise<number[][]> => {
      rec.embedCalls += 1;
      return texts.map(() => new Array(1024).fill(0.01));
    },
  } as unknown as Embedder;

  return new BusinessBrain({ db, embedder });
}

describe('BusinessBrain.upsertKnowledge', () => {
  it('replaces the prior version when an externalRef is supplied (idempotent re-index)', async () => {
    const rec = newRecord();
    const brain = makeBrain(rec);

    await brain.upsertKnowledge('org_1', {
      sourceKind: 'website_page',
      externalRef: 'https://example.com',
      content: 'We are open 9am to 5pm on weekdays.',
    });

    // A dedup delete fires exactly once before the inserts, embedding runs first.
    expect(rec.embedCalls).toBe(1);
    expect(rec.deletes).toBe(1);
    // source + document + chunks = at least two inserts.
    expect(rec.inserts).toBeGreaterThanOrEqual(2);
  });

  it('appends (no dedup delete) when no externalRef is supplied', async () => {
    const rec = newRecord();
    const brain = makeBrain(rec);

    await brain.upsertKnowledge('org_1', {
      sourceKind: 'note',
      content: 'A short internal note about opening hours.',
    });

    expect(rec.deletes).toBe(0);
    expect(rec.embedCalls).toBe(1);
    expect(rec.inserts).toBeGreaterThanOrEqual(2);
  });

  it('is a no-op for empty content — no embed, no delete, no writes', async () => {
    const rec = newRecord();
    const brain = makeBrain(rec);

    await brain.upsertKnowledge('org_1', {
      sourceKind: 'website_page',
      externalRef: 'https://example.com',
      content: '   ',
    });

    expect(rec.embedCalls).toBe(0);
    expect(rec.deletes).toBe(0);
    expect(rec.inserts).toBe(0);
  });
});

describe('BusinessBrain.indexApprovedKnowledge', () => {
  function makeBrainWith(rows: {
    faqs: unknown[];
    policies: unknown[];
    objections: unknown[];
  }): BusinessBrain {
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () =>
            Promise.resolve(
              table === faqs
                ? rows.faqs
                : table === policies
                  ? rows.policies
                  : table === objections
                    ? rows.objections
                    : [],
            ),
        }),
      }),
    } as unknown as Database;
    const embedder = {
      embed: async (texts: string[]): Promise<number[][]> => texts.map(() => new Array(1024).fill(0)),
    } as unknown as Embedder;
    return new BusinessBrain({ db, embedder });
  }

  it('indexes approved FAQs/policies/objections as public knowledge, skipping rebuttal-less objections', async () => {
    const brain = makeBrainWith({
      faqs: [{ id: 'faq_1', question: 'Opening hours?', answer: '9-5 weekdays' }],
      policies: [{ id: 'pol_1', kind: 'Refund', body: '30-day money back' }],
      objections: [
        { id: 'obj_1', objection: 'Too expensive', rebuttal: 'Pays for itself in two weeks' },
        { id: 'obj_2', objection: 'Not sure it works', rebuttal: null }, // no answer → skipped
      ],
    });
    const spy = vi.spyOn(brain, 'upsertKnowledge').mockResolvedValue(undefined);

    const count = await brain.indexApprovedKnowledge('org_1');

    expect(count).toBe(3); // faq + policy + obj_1 (obj_2 has no rebuttal)
    expect(spy).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ externalRef: 'faq:faq_1', sourceKind: 'faq', permission: 'public' }),
    );
    expect(spy).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ externalRef: 'policy:pol_1', sourceKind: 'policy' }),
    );
    expect(spy).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ externalRef: 'objection:obj_1' }),
    );
    // The rebuttal-less objection is never indexed (nothing to ground on).
    expect(spy).not.toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ externalRef: 'objection:obj_2' }),
    );
  });

  it('indexes nothing when there is no approved knowledge', async () => {
    const brain = makeBrainWith({ faqs: [], policies: [], objections: [] });
    const spy = vi.spyOn(brain, 'upsertKnowledge').mockResolvedValue(undefined);

    const count = await brain.indexApprovedKnowledge('org_1');

    expect(count).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
