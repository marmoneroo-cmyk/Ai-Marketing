import { describe, expect, it } from 'vitest';
import { scheduledPosts, contentVariants, publishJobs, type Database } from '@brandpilot/db';
import type { BusinessBrain } from '@brandpilot/business-brain';
import type { Connector, PushAction, PushResult } from '@brandpilot/connectors';
import { PublishingEngine } from './publishing-engine';

/**
 * Behavioural tests for the publish state machine (`processScheduledPost`): the
 * scheduled → publishing → published/failed transitions, a recorded publishJob
 * either way, a `post_published` signal only on success, PLUS the idempotency /
 * fault-isolation guarantees (a publish is non-idempotent + irreversible, so a
 * retry must not double-post and post-publish bookkeeping must not revert a live
 * post). A fake Drizzle db + fake connector drive it without a DB or network.
 */

interface Recorded {
  publishJobs: Array<Record<string, unknown>>;
  statusUpdates: string[];
  signals: string[];
}

const POST = { id: 'sp1', orgId: 'org1', contentVariantId: 'cv1', socialAccountId: 'sa1' };
const VARIANT = {
  id: 'cv1',
  contentItemId: 'ci1',
  platform: 'instagram',
  caption: 'hello',
  hook: 'hook',
  cta: 'cta',
  hashtags: ['#a'],
};

/**
 * Fake db: `.where()` is awaitable (nextAttempt) AND has `.limit()` (row lookups).
 * `publishJobsRows` seeds what a `select … from(publishJobs)` returns (prior attempts).
 */
function fakeDb(rec: Recorded, publishJobsRows: unknown[] = []): Database {
  return {
    select: () => ({
      from: (table: unknown) => {
        const rows =
          table === scheduledPosts
            ? [POST]
            : table === contentVariants
              ? [VARIANT]
              : table === publishJobs
                ? publishJobsRows
                : [];
        const awaitableWithLimit = Object.assign(Promise.resolve(rows), {
          limit: () => Promise.resolve(rows),
        });
        return { where: () => awaitableWithLimit };
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        if (table === publishJobs) rec.publishJobs.push(vals);
        return Promise.resolve([]);
      },
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        if (typeof vals.status === 'string') rec.statusUpdates.push(vals.status);
        return { where: () => Promise.resolve([]) };
      },
    }),
  } as unknown as Database;
}

function makeEngine(
  rec: Recorded,
  opts: { publishJobsRows?: unknown[]; recordSignal?: () => Promise<void> } = {},
): PublishingEngine {
  const db = fakeDb(rec, opts.publishJobsRows);
  const brain = {
    recordSignal: async (_orgId: string, signal: { type: string }) => {
      if (opts.recordSignal) return opts.recordSignal();
      rec.signals.push(signal.type);
    },
  } as unknown as BusinessBrain;
  return new PublishingEngine({ db, brain });
}

function connector(push: (a: PushAction) => Promise<PushResult>): Connector {
  return { provider: 'instagram', push } as unknown as Connector;
}

function newRecord(): Recorded {
  return { publishJobs: [], statusUpdates: [], signals: [] };
}

describe('PublishingEngine.processScheduledPost', () => {
  it('publishes: scheduled → publishing → published, records success + post_published signal', async () => {
    const rec = newRecord();
    const engine = makeEngine(rec);

    const result = await engine.processScheduledPost(
      'org1',
      'sp1',
      connector(async () => ({ externalId: 'ext_1', raw: {} })),
      'token',
    );

    expect(result.status).toBe('published');
    expect(rec.statusUpdates).toEqual(['publishing', 'published']);
    expect(rec.publishJobs.some((j) => j.status === 'success')).toBe(true);
    expect(rec.signals).toContain('post_published');
  });

  it('records a failed attempt and flips to failed (never rethrows) when the connector push throws', async () => {
    const rec = newRecord();
    const engine = makeEngine(rec);

    const result = await engine.processScheduledPost(
      'org1',
      'sp1',
      connector(async () => {
        throw new Error('graph boom');
      }),
      'token',
    );

    expect(result.status).toBe('failed');
    expect(rec.statusUpdates).toEqual(['publishing', 'failed']);
    expect(rec.publishJobs.some((j) => j.status === 'error')).toBe(true);
    // No success signal emitted on failure.
    expect(rec.signals).not.toContain('post_published');
  });

  it('is idempotent: a prior successful attempt short-circuits WITHOUT re-pushing (no double-post)', async () => {
    const rec = newRecord();
    const engine = makeEngine(rec, {
      publishJobsRows: [{ status: 'success', externalPostId: 'ext_prior' }],
    });

    let pushed = false;
    const result = await engine.processScheduledPost(
      'org1',
      'sp1',
      connector(async () => {
        pushed = true;
        return { externalId: 'ext_new', raw: {} };
      }),
      'token',
    );

    expect(pushed).toBe(false); // the platform push is NEVER called a second time
    expect(result.status).toBe('published');
    expect(result.externalPostId).toBe('ext_prior');
    expect(rec.statusUpdates).not.toContain('publishing');
    expect(rec.publishJobs).toHaveLength(0); // no duplicate job recorded
  });

  it('keeps a published post published when the post_published signal fails (bookkeeping must not revert a live post)', async () => {
    const rec = newRecord();
    const engine = makeEngine(rec, {
      recordSignal: async () => {
        throw new Error('brain unavailable');
      },
    });

    const result = await engine.processScheduledPost(
      'org1',
      'sp1',
      connector(async () => ({ externalId: 'ext_ok', raw: {} })),
      'token',
    );

    expect(result.status).toBe('published');
    expect(rec.statusUpdates).toEqual(['publishing', 'published']); // never 'failed'
    expect(rec.publishJobs.some((j) => j.status === 'success')).toBe(true);
    expect(rec.publishJobs.some((j) => j.status === 'error')).toBe(false);
  });
});
