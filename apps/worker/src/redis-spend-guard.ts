import type IORedis from 'ioredis';
import { AppError, type SpendGuard, type SpendKind } from '@brandpilot/core';
import { DEFAULT_DAILY_LLM_CALLS, DEFAULT_DAILY_MEDIA_CALLS } from '@brandpilot/config';
import { logger } from '@brandpilot/observability';

/**
 * Two days in seconds. The counter key is stamped with today's UTC date, so a
 * generous 48h TTL both bridges the UTC-midnight rollover and lets stale keys
 * expire on their own without a sweeper.
 */
const COUNTER_TTL_SECONDS = 172_800;

/** An org's resolved daily call ceilings for the two SpendGuard-metered kinds. */
export interface SpendLimits {
  llm: number;
  media: number;
}

/** Per-org daily cap for a spend kind. `embedding` shares the LLM budget. */
function capFor(kind: SpendKind, limits: SpendLimits): number {
  return kind === 'media' ? limits.media : limits.llm;
}

/** UTC calendar day (YYYY-MM-DD) — the window each counter is bucketed into. */
function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Redis-backed {@link SpendGuard} enforcing a per-org, per-kind daily call cap.
 *
 * Each `consume` atomically `INCRBY`s the counter at
 * `spend:{orgId}:{kind}:{YYYY-MM-DD}` (UTC) and sets a ~48h `EXPIRE` on the
 * first write of the window. If the post-increment total exceeds the cap it
 * throws `AppError('rate_limited', ...)`.
 *
 * Note: unlike the cache, this deliberately does NOT swallow Redis errors — a
 * meter that silently fails open would let an org exceed its budget, so a
 * transport failure propagates to the caller.
 */
export class RedisSpendGuard implements SpendGuard {
  private readonly redis: IORedis;
  private readonly resolveLimits?: (orgId: string) => Promise<SpendLimits>;

  /**
   * `resolveLimits`, when provided, resolves an org's plan-based daily caps
   * (see `apps/worker/src/context.ts`); omit it to fall back to the fixed
   * `DEFAULT_DAILY_LLM_CALLS`/`DEFAULT_DAILY_MEDIA_CALLS` — the exact behavior
   * this class had before plan-aware limits existed.
   */
  constructor(redis: IORedis, resolveLimits?: (orgId: string) => Promise<SpendLimits>) {
    this.redis = redis;
    // `exactOptionalPropertyTypes`: only assign the field when a resolver was
    // actually passed, so an absent argument leaves the property genuinely
    // unset rather than explicitly `undefined`.
    if (resolveLimits) {
      this.resolveLimits = resolveLimits;
    }
  }

  async consume(orgId: string, kind: SpendKind, units: number): Promise<void> {
    const key = `spend:${orgId}:${kind}:${utcDay(new Date())}`;

    const total = await this.redis.incrby(key, units);
    // First write of the window: stamp the TTL so the key self-expires.
    if (total === units) {
      await this.redis.expire(key, COUNTER_TTL_SECONDS);
    }

    const limits = this.resolveLimits
      ? await this.resolveLimits(orgId)
      : { llm: DEFAULT_DAILY_LLM_CALLS, media: DEFAULT_DAILY_MEDIA_CALLS };

    if (total > capFor(kind, limits)) {
      logger.warn({ orgId, kind, total, cap: capFor(kind, limits) }, 'daily spend limit reached');
      throw new AppError('rate_limited', `Daily ${kind} limit reached`);
    }
  }
}
