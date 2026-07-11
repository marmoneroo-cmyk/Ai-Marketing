import { pgTable, uuid, text, numeric, jsonb, timestamp, date, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { ContentFormat, PublishPlatform } from '@brandpilot/core';
import { primaryId } from './_shared';
import { users, orgRef } from './identity';

/** Content Engine: strategy → planned items → per-platform variants → approvals. */

export const contentPlans = pgTable('content_plans', {
  id: primaryId(),
  orgId: orgRef(),
  // NOTE: doc 02 used a daterange; split into two date columns.
  periodStart: date('period_start'),
  periodEnd: date('period_end'),
  strategy: jsonb('strategy').notNull().default({}), // pillars, cadence, goals
  status: text('status')
    .$type<'draft' | 'approved' | 'active' | 'archived'>()
    .notNull()
    .default('draft'),
  createdBy: text('created_by'), // user id or agent
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const contentItems = pgTable(
  'content_items',
  {
    id: primaryId(),
    orgId: orgRef(),
    planId: uuid('plan_id').references(() => contentPlans.id, { onDelete: 'set null' }),
    pillar: text('pillar'),
    format: text('format').$type<ContentFormat>().notNull(),
    brief: text('brief'), // hook / angle / CTA idea
    status: text('status')
      .$type<'idea' | 'drafted' | 'approved' | 'scheduled' | 'published' | 'rejected'>()
      .notNull()
      .default('idea'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Variant-generation worker + content-list-by-plan filter on (orgId, planId);
  // list endpoint orders by createdAt within the org.
  (t) => [
    index('content_items_org_plan_idx').on(t.orgId, t.planId),
    index('content_items_org_created_idx').on(t.orgId, t.createdAt),
  ],
);

export const contentVariants = pgTable(
  'content_variants',
  {
    id: primaryId(),
    orgId: orgRef(),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    platform: text('platform').$type<PublishPlatform>().notNull(),
    caption: text('caption'),
    hook: text('hook'),
    cta: text('cta'),
    hashtags: text('hashtags').array().notNull().default(sql`'{}'::text[]`),
    assetIds: uuid('asset_ids').array().notNull().default(sql`'{}'::uuid[]`), // → creative_assets
    voiceScore: numeric('voice_score', { precision: 4, scale: 3 }), // brand-voice conformance
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Variant lookups per content item (inArray on contentItemId) ordered by createdAt.
  (t) => [index('content_variants_item_created_idx').on(t.contentItemId, t.createdAt)],
);

export const contentApprovals = pgTable(
  'content_approvals',
  {
    id: primaryId(),
    orgId: orgRef(),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    decidedBy: uuid('decided_by').references(() => users.id),
    decision: text('decision')
      .$type<'pending' | 'approved' | 'changes' | 'rejected'>()
      .notNull()
      .default('pending'),
    notes: text('notes'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  // Content-list load resolves approvals via inArray(contentItemId, itemIds) per org.
  // No index existed on this table at all before this.
  (t) => [index('content_approvals_org_item_idx').on(t.orgId, t.contentItemId)],
);
