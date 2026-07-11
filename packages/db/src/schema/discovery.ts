import { pgTable, uuid, text, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId } from './_shared';
import { orgRef } from './identity';

/** Discovery Engine: pulls and normalizes public presence into the Business Brain. */

export const discoveryRuns = pgTable('discovery_runs', {
  id: primaryId(),
  orgId: orgRef(),
  status: text('status')
    .$type<'queued' | 'running' | 'partial' | 'done' | 'failed'>()
    .notNull()
    .default('queued'),
  sources: text('sources').array().notNull().default(sql`'{}'::text[]`),
  stats: jsonb('stats').notNull().default({}), // counts per source
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ingestedAssets = pgTable(
  'ingested_assets',
  {
    id: primaryId(),
    orgId: orgRef(),
    runId: uuid('run_id').references(() => discoveryRuns.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    kind: text('kind')
      .$type<'post' | 'reel' | 'story' | 'image' | 'video' | 'comment' | 'review' | 'page'>()
      .notNull(),
    externalId: text('external_id'),
    raw: jsonb('raw').notNull().default({}),
    storageKey: text('storage_key'),
    metrics: jsonb('metrics').notNull().default({}),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
  },
  (t) => [
    unique('ingested_assets_org_provider_kind_ext_uq').on(
      t.orgId,
      t.provider,
      t.kind,
      t.externalId,
    ),
  ],
);
