import type IORedis from 'ioredis';
import type { Cache } from '@brandpilot/core';
import { logger } from '@brandpilot/observability';

/**
 * Redis-backed {@link Cache} over the shared ioredis connection.
 *
 * Values are JSON-serialized. Every operation is defensive: a Redis hiccup
 * (connection drop, timeout, malformed payload) degrades to a cache miss
 * (`get` → `null`) or a silent no-op (`set` / `del`) instead of throwing, so a
 * transient cache fault never breaks the underlying business operation.
 */
export class RedisCache implements Cache {
  private readonly redis: IORedis;

  constructor(redis: IORedis) {
    this.redis = redis;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) {
        return null;
      }
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      logger.warn({ key, err }, 'RedisCache get failed; treating as miss');
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err: unknown) {
      logger.warn({ key, err }, 'RedisCache set failed; skipping');
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err: unknown) {
      logger.warn({ key, err }, 'RedisCache del failed; skipping');
    }
  }
}
