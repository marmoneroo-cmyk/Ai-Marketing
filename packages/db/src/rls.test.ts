import { describe, expect, it } from 'vitest';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from './schema';
import { RLS_STATEMENTS } from './rls';

/**
 * Multi-tenancy safety net. `rls.ts` isolates a *hand-maintained* list of
 * tables; this test derives the ground truth from the schema itself so a new
 * table added with an `org_id` column can never silently ship without an
 * RLS policy (a cross-tenant leak). It is the automated version of the manual
 * cross-check — if it fails, add the table to `ORG_SCOPED_TABLES` in `rls.ts`.
 */

/** Table names that receive an isolation policy, parsed from the canonical SQL. */
const isolatedTables = new Set(
  RLS_STATEMENTS.map((stmt) => stmt.match(/ON "([a-z0-9_]+)"/)?.[1]).filter(
    (name): name is string => Boolean(name),
  ),
);

/** All Drizzle pgTables exported from the schema barrel. */
const allTables = (Object.values(schema) as unknown[]).filter(
  (value): value is PgTable => is(value, PgTable),
);

/** DB column names present on a table. */
function columnNames(table: PgTable): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

describe('RLS coverage (multi-tenant isolation)', () => {
  it('parses a non-trivial schema and policy set (guards against a broken test)', () => {
    expect(allTables.length).toBeGreaterThan(40);
    expect(isolatedTables.size).toBeGreaterThan(40);
  });

  it('every table with an org_id column has an isolation policy', () => {
    const unprotected = allTables
      .filter((table) => columnNames(table).includes('org_id'))
      .map((table) => getTableName(table))
      .filter((name) => !isolatedTables.has(name));

    expect(unprotected).toEqual([]);
  });

  it('the organizations tenant-root is isolated (on its own id)', () => {
    expect(isolatedTables.has('organizations')).toBe(true);
  });

  it('every isolation policy targets a table that exists in the schema', () => {
    const schemaNames = new Set(allTables.map((table) => getTableName(table)));
    const stale = [...isolatedTables].filter((name) => !schemaNames.has(name));

    expect(stale).toEqual([]);
  });
});
