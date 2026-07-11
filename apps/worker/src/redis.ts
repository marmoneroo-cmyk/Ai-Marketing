import IORedis from 'ioredis';
import { loadEnv } from '@brandpilot/config';

/** A Redis connection configured for BullMQ (requires maxRetriesPerRequest: null). */
export function createRedisConnection(): IORedis {
  const env = loadEnv();
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
