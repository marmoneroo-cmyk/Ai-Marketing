import type { Provider } from '@nestjs/common';
import { createDb } from '@brandpilot/db';
import { loadEnv } from '@brandpilot/config';

/** Injection token for the shared Drizzle client. */
export const DATABASE = Symbol('DATABASE');

/**
 * Provides a single Drizzle client for the whole app, built from the validated
 * env. Callers inject it via `@Inject(DATABASE)`.
 */
export const databaseProvider: Provider = {
  provide: DATABASE,
  useFactory: () => createDb(loadEnv().DATABASE_URL),
};
