import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@brandpilot/observability';
import { buildPlanLimitsResolver, type OrganizationsReader } from './context';

/**
 * Minimal fake satisfying {@link OrganizationsReader} — just the one
 * `db.query.organizations.findFirst` call `buildPlanLimitsResolver` actually
 * makes. `findFirstImpl` is swappable per test to drive success/failure; the
 * returned `callCount` lets tests observe how many times the underlying
 * "DB" was actually queried, to verify the TTL/eviction cache is doing its
 * job (none of these tests need per-orgId responses, since the resolver
 * itself passes the orgId only through the `where` clause, not the result).
 */
function createFakeDb(
  findFirstImpl: () => Promise<{ plan: string; settings?: unknown } | undefined>,
): { db: OrganizationsReader; callCount: () => number } {
  let calls = 0;
  const db: OrganizationsReader = {
    query: {
      organizations: {
        findFirst: (async () => {
          calls += 1;
          return findFirstImpl();
        }) as OrganizationsReader['query']['organizations']['findFirst'],
      },
    },
  };
  return { db, callCount: () => calls };
}

describe('buildPlanLimitsResolver', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('DB read failure (FIX 1: fail closed with logging)', () => {
    it('logs the error with orgId and rethrows, propagating the failure', async () => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
      const dbError = new Error('connection reset');
      const { db } = createFakeDb(() => Promise.reject(dbError));
      const resolveLimits = buildPlanLimitsResolver(db);

      await expect(resolveLimits('org_fail')).rejects.toThrow('connection reset');

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        { err: dbError, orgId: 'org_fail' },
        'plan limits resolution failed; job will fail closed',
      );
    });

    it('does not cache anything on failure, so a subsequent call retries the DB', async () => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
      let attempt = 0;
      const { db } = createFakeDb(() => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new Error('transient'))
          : Promise.resolve({ plan: 'free', settings: undefined });
      });
      const resolveLimits = buildPlanLimitsResolver(db);

      await expect(resolveLimits('org_retry')).rejects.toThrow('transient');
      await expect(resolveLimits('org_retry')).resolves.toEqual(expect.any(Object));

      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('bounded cache growth (FIX 3)', () => {
    it('caches a resolved org so a second lookup within the TTL does not re-query the DB', async () => {
      const { db, callCount } = createFakeDb(() => Promise.resolve({ plan: 'free', settings: undefined }));
      const resolveLimits = buildPlanLimitsResolver(db);

      await resolveLimits('org_cached');
      await resolveLimits('org_cached');

      expect(callCount()).toBe(1);
    });

    it('evicts the oldest entry once more than MAX_PLAN_CACHE_ENTRIES distinct orgs are seen', async () => {
      // MAX_PLAN_CACHE_ENTRIES is an internal module const (not exported, per
      // spec) — this test drives eviction behaviorally instead of asserting
      // against the literal constant: insert a large-enough number of
      // distinct orgIds that eviction MUST have occurred for the cache to
      // stay bounded, then confirm the very first org inserted was evicted
      // (proving insertion-order eviction, not unbounded growth) while a
      // recently-inserted org is still cached.
      const ORG_COUNT = 5001; // MAX_PLAN_CACHE_ENTRIES (5000) + 1
      const { db, callCount } = createFakeDb(() => Promise.resolve({ plan: 'free', settings: undefined }));
      const resolveLimits = buildPlanLimitsResolver(db);

      for (let i = 0; i < ORG_COUNT; i += 1) {
        await resolveLimits(`org_${i}`);
      }
      expect(callCount()).toBe(ORG_COUNT);

      // The very first org inserted (org_0) must have been evicted to make
      // room, so re-resolving it triggers a fresh DB read.
      const callsBeforeRefetch = callCount();
      await resolveLimits('org_0');
      expect(callCount()).toBe(callsBeforeRefetch + 1);

      // The most recently inserted org must still be cached (no re-fetch).
      const callsBeforeRecent = callCount();
      await resolveLimits(`org_${ORG_COUNT - 1}`);
      expect(callCount()).toBe(callsBeforeRecent);
    }, 20_000);
  });
});
