import { sql } from 'drizzle-orm';
import type { SQLWrapper } from 'drizzle-orm';

/**
 * Minimal database surface {@link applyRls} needs: the ability to execute a raw
 * statement. Both the schema-bound {@link Database} and the schema-less handle
 * used by the migration script satisfy this, so RLS can be applied from either
 * without coupling to the full Drizzle generic signature.
 */
export interface RlsExecutor {
  execute(query: SQLWrapper | string): unknown;
}

/**
 * Postgres Row-Level Security (RLS) as defense-in-depth for multi-tenancy.
 *
 * Application code already scopes every query by `org_id`, but RLS ensures the
 * database itself refuses to leak rows across tenants even if a query forgets
 * the filter. Policies key off `current_setting('app.org_id', true)` — the
 * per-transaction GUC set by {@link withOrgScope} in `client.ts`. The second
 * argument (`true`) makes the lookup return NULL rather than erroring when the
 * setting is absent, so out-of-band/admin connections that never set it simply
 * match no rows for org-scoped tables.
 *
 * Every table carrying an `org_id` column is isolated on that column. The
 * `organizations` table has no `org_id` (it *is* the tenant) so it is isolated
 * on its primary key `id` instead. Tables without any org linkage
 * (`users`, `permissions`, `connector_tokens`) are intentionally excluded.
 */

/** Every table with an `org_id` column (isolated on `org_id`). */
const ORG_SCOPED_TABLES: readonly string[] = [
  'post_metrics',
  'kpi_daily',
  'availability_slots',
  'appointments',
  'approvals',
  'owner_tasks',
  'workflows',
  'workflow_runs',
  'workflow_step_runs',
  'brand_voice_profiles',
  'audience_segments',
  'insights',
  'signals',
  'knowledge_sources',
  'knowledge_documents',
  'knowledge_chunks',
  'business_profiles',
  'products',
  'services',
  'pricing_plans',
  'customer_personas',
  'competitors',
  'brand_kits',
  'brand_assets',
  'faqs',
  'policies',
  'offers',
  'sales_process_stages',
  'testimonials',
  'objections',
  'onboarding_answers',
  'social_accounts',
  'webhook_subscriptions',
  'content_plans',
  'content_items',
  'content_variants',
  'content_approvals',
  'conversations',
  'conversation_messages',
  'creative_jobs',
  'creative_assets',
  'contacts',
  'pipeline_stages',
  'leads',
  'lead_activities',
  'deals',
  'discovery_runs',
  'ingested_assets',
  'memberships',
  'api_keys',
  'audit_logs',
  'experiments',
  'scheduled_posts',
  'publish_jobs',
  'proposals',
  'quotes',
  'payment_links',
  'billing_subscriptions',
  'org_invites',
];

/** The `organizations` table isolates on its primary key rather than `org_id`. */
const ORG_ROOT_TABLE = 'organizations';

/** Build the `USING` predicate column for a given table. */
function isolationColumn(table: string): string {
  return table === ORG_ROOT_TABLE ? 'id' : 'org_id';
}

function enableStatement(table: string): string {
  return `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`;
}

function createPolicyStatement(table: string): string {
  const column = isolationColumn(table);
  return (
    `CREATE POLICY "${table}_org_isolation" ON "${table}" ` +
    `USING (${column} = nullif(current_setting('app.org_id', true), '')::uuid);`
  );
}

/** All tables that receive an isolation policy (org-scoped tables + the org root). */
const ALL_ISOLATED_TABLES: readonly string[] = [...ORG_SCOPED_TABLES, ORG_ROOT_TABLE];

/**
 * The canonical RLS statements: for every isolated table, an `ENABLE ROW LEVEL
 * SECURITY` followed by its `CREATE POLICY`. Exported for inspection and use in
 * generated SQL. To apply idempotently against a live database, prefer
 * {@link applyRls}, which additionally drops any existing policy first so that
 * re-runs do not fail with "policy already exists".
 */
export const RLS_STATEMENTS: string[] = ALL_ISOLATED_TABLES.flatMap((table) => [
  enableStatement(table),
  createPolicyStatement(table),
]);

/**
 * Apply RLS to the database idempotently. Enabling RLS is naturally idempotent;
 * policy creation is made re-runnable by dropping any existing same-named policy
 * first. Safe to call on every migration.
 */
export async function applyRls(db: RlsExecutor): Promise<void> {
  for (const table of ALL_ISOLATED_TABLES) {
    await db.execute(sql.raw(enableStatement(table)));
    await db.execute(sql.raw(`DROP POLICY IF EXISTS "${table}_org_isolation" ON "${table}";`));
    await db.execute(sql.raw(createPolicyStatement(table)));
  }
}
