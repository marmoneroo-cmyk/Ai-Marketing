import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema/index';

/**
 * Create a Drizzle client bound to the full schema. Callers pass their own
 * connection string (from the validated env) so this module has no env coupling.
 */
export function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: 10 });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
export { schema };

/**
 * Run `fn` inside a transaction whose `app.org_id` GUC is set to `orgId`, which
 * is the mechanism that activates the Postgres Row-Level Security policies (see
 * `rls.ts`). The setting is transaction-local (`set_config(..., true)`), so it
 * is scoped to this transaction and rolled back automatically.
 *
 * Controllers should wrap every org-scoped database access in this helper so
 * that RLS enforces tenant isolation as defense-in-depth behind the
 * application-level `org_id` filters. `orgId` is passed as a bound parameter,
 * never string-interpolated, so it cannot be used for SQL injection.
 */
export async function withOrgScope<T>(
  db: Database,
  orgId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx as unknown as Database);
  });
}
