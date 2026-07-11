import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { primaryId } from './_shared';
import { orgRef } from './identity';
import { contentVariants } from './content';

/** Publishing Engine: schedules per-platform posts and records retryable publish attempts. */

export const scheduledPosts = pgTable(
  'scheduled_posts',
  {
    id: primaryId(),
    orgId: orgRef(),
    contentVariantId: uuid('content_variant_id')
      .notNull()
      .references(() => contentVariants.id, { onDelete: 'cascade' }),
    // FK to social_accounts (connections.ts) — added later
    socialAccountId: uuid('social_account_id').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    status: text('status')
      .$type<'scheduled' | 'publishing' | 'published' | 'failed' | 'paused' | 'canceled'>()
      .notNull()
      .default('scheduled'),
    approvalRequired: boolean('approval_required').notNull().default(true),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('scheduled_posts_org_scheduled_idx').on(t.orgId, t.scheduledFor),
    // publish tick claims due posts globally by (status, scheduledFor) across orgs.
    index('scheduled_posts_status_scheduled_idx').on(t.status, t.scheduledFor),
  ],
);

export const publishJobs = pgTable('publish_jobs', {
  id: primaryId(),
  orgId: orgRef(),
  scheduledPostId: uuid('scheduled_post_id')
    .notNull()
    .references(() => scheduledPosts.id, { onDelete: 'cascade' }),
  attempt: integer('attempt').notNull().default(1),
  status: text('status').$type<'pending' | 'success' | 'error'>().notNull(),
  externalPostId: text('external_post_id'),
  error: jsonb('error'),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});
