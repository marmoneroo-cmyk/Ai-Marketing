import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadEnv } from '@brandpilot/config';
import { applyRls } from './rls';

/** Apply pending migrations. Ensures required Postgres extensions first. */
async function main(): Promise<void> {
  const env = loadEnv();
  const sql = postgres(env.DATABASE_URL, { max: 1 });
  await sql`CREATE EXTENSION IF NOT EXISTS vector;`;
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: './drizzle' });
  // Defense-in-depth: (re)apply Row-Level Security policies idempotently so the
  // database enforces tenant isolation even if an application query omits org_id.
  await applyRls(db);
  await sql.end();
  console.log('✔ Migrations applied.');
}

main().catch((err) => {
  console.error('✖ Migration failed:', err);
  process.exit(1);
});
