import { pgTable, uuid, text, integer, numeric, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { primaryId } from './_shared';
import { orgRef } from './identity';
import { contentItems } from './content';

/** Creative Studio: brand-aware image/video generation jobs and their outputs. */

export const creativeJobs = pgTable(
  'creative_jobs',
  {
    id: primaryId(),
    orgId: orgRef(),
    contentItemId: uuid('content_item_id').references(() => contentItems.id, {
      onDelete: 'set null',
    }),
    kind: text('kind')
      .$type<'image' | 'carousel' | 'story' | 'cover' | 'thumbnail' | 'video' | 'ad'>()
      .notNull(),
    prompt: jsonb('prompt').notNull().default({}),
    provider: text('provider').notNull().default('fal'),
    status: text('status')
      .$type<'queued' | 'rendering' | 'done' | 'failed'>()
      .notNull()
      .default('queued'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Content-media join (creativeAssets.jobId → creativeJobs.id) plus the org filter
  // on that join path. No index existed on this table at all before this.
  (t) => [index('creative_jobs_org_item_idx').on(t.orgId, t.contentItemId)],
);

export const creativeAssets = pgTable(
  'creative_assets',
  {
    id: primaryId(),
    orgId: orgRef(),
    jobId: uuid('job_id').references(() => creativeJobs.id, { onDelete: 'set null' }),
    storageKey: text('storage_key').notNull(),
    mime: text('mime'),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    brandCheck: numeric('brand_check', { precision: 4, scale: 3 }), // adherence to brand kit
    meta: jsonb('meta').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Serves creativeAssets.jobId = creativeJobs.id joined with the orgId filter.
  // No index existed on this table at all before this.
  (t) => [index('creative_assets_org_job_idx').on(t.orgId, t.jobId)],
);
