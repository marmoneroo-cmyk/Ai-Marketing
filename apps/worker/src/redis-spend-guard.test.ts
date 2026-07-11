import { afterEach, describe, expect, it, vi } from 'vitest';
import type IORedis from 'ioredis';
import { AppError } from '@brandpilot/core';
import { DEFAULT_DAILY_LLM_CALLS, DEFAULT_DAILY_MEDIA_CALLS } from '@brandpilot/config';
import { logger } from '@brandpilot/observability';
import { RedisSpendGuard, type SpendLimits } from './redis-spend-guard';

/**
 * Minimal in-memory fake for the two IORedis calls `RedisSpendGuard` actually
 * makes (`incrby`, `expire`) — enough to exercise the counter/cap logic
 * without a real Redis connection. Cast to `IORedis` at the call site since
 * this intentionally implements only the used subset.
 */
function createFakeRedis(): IORedis {
  const counters = new Map<string, number>();
  return {
    incrby: async (key: string, units: number) => {
      const next = (counters.get(key) ?? 0) + units;
      counters.set(key, next);
      return next;
    },
    expire: async () => 1,
  } as unknown as IORedis;
}

describe('RedisSpendGuard', () => {
  describe('without a resolveLimits callback (legacy/default behavior)', () => {
    it('allows consumption up to the fixed DEFAULT_DAILY_LLM_CALLS cap', async () => {
      const guard = new RedisSpendGuard(createFakeRedis());
      await expect(
        guard.consume('org_1', 'llm', DEFAULT_DAILY_LLM_CALLS),
      ).resolves.toBeUndefined();
    });

    it('throws once the fixed default cap is exceeded', async () => {
      const guard = new RedisSpendGuard(createFakeRedis());
      await expect(
        guard.consume('org_1', 'llm', DEFAULT_DAILY_LLM_CALLS + 1),
      ).rejects.toThrow(AppError);
    });

    it('enforces the fixed default media cap independently of the llm cap', async () => {
      const guard = new RedisSpendGuard(createFakeRedis());
      await expect(
        guard.consume('org_1', 'media', DEFAULT_DAILY_MEDIA_CALLS + 1),
      ).rejects.toThrow(AppError);
    });
  });

  describe('with a resolveLimits callback (plan-aware limits)', () => {
    it('uses the resolved per-org limit: a third 1-unit consume at limit 2 throws', async () => {
      const resolveLimits = async (): Promise<SpendLimits> => ({ llm: 2, media: 2 });
      const guard = new RedisSpendGuard(createFakeRedis(), resolveLimits);

      await expect(guard.consume('org_2', 'llm', 1)).resolves.toBeUndefined();
      await expect(guard.consume('org_2', 'llm', 1)).resolves.toBeUndefined();
      await expect(guard.consume('org_2', 'llm', 1)).rejects.toThrow(AppError);
    });

    it('resolves limits independently per org (a low cap for one org does not affect another)', async () => {
      const resolveLimits = async (orgId: string): Promise<SpendLimits> =>
        orgId === 'org_low' ? { llm: 1, media: 1 } : { llm: 100, media: 100 };
      const guard = new RedisSpendGuard(createFakeRedis(), resolveLimits);

      await expect(guard.consume('org_low', 'llm', 1)).resolves.toBeUndefined();
      await expect(guard.consume('org_low', 'llm', 1)).rejects.toThrow(AppError);
      await expect(guard.consume('org_high', 'llm', 50)).resolves.toBeUndefined();
    });
  });

  describe('daily limit rejection logging', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('logs a warning with orgId, kind, total, and cap immediately before throwing', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
      const resolveLimits = async (): Promise<SpendLimits> => ({ llm: 1, media: 1 });
      const guard = new RedisSpendGuard(createFakeRedis(), resolveLimits);

      await expect(guard.consume('org_warn', 'llm', 2)).rejects.toThrow(AppError);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        { orgId: 'org_warn', kind: 'llm', total: 2, cap: 1 },
        'daily spend limit reached',
      );
    });

    it('does not log a warning when consumption stays within the cap', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
      const guard = new RedisSpendGuard(createFakeRedis());

      await expect(guard.consume('org_ok', 'llm', 1)).resolves.toBeUndefined();

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
