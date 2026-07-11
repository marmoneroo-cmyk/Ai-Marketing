import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  date,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { primaryId } from './_shared';
import { orgRef } from './identity';
import { scheduledPosts } from './publishing';

/** Analytics: per-post time-series snapshots and rolled-up daily KPIs. */

export const postMetrics = pgTable(
  'post_metrics',
  {
    id: primaryId(),
    orgId: orgRef(),
    scheduledPostId: uuid('scheduled_post_id').references(() => scheduledPosts.id, {
      onDelete: 'set null',
    }),
    externalPostId: text('external_post_id'),
    platform: text('platform').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
    reach: integer('reach'),
    impressions: integer('impressions'),
    likes: integer('likes'),
    comments: integer('comments'),
    shares: integer('shares'),
    saves: integer('saves'),
    clicks: integer('clicks'),
    videoViews: integer('video_views'),
    raw: jsonb('raw').notNull().default({}),
  },
  (t) => [index('post_metrics_org_platform_captured_idx').on(t.orgId, t.platform, t.capturedAt)],
);

// Composite PK (org_id, day); no id, no timestamps.
export const kpiDaily = pgTable(
  'kpi_daily',
  {
    orgId: orgRef(),
    day: date('day').notNull(),
    reach: integer('reach'),
    impressions: integer('impressions'),
    engagement: integer('engagement'),
    ctr: numeric('ctr'),
    leads: integer('leads'),
    appointments: integer('appointments'),
    sales: integer('sales'),
    revenue: numeric('revenue', { precision: 12, scale: 2 }),
    conversionRate: numeric('conversion_rate'),
    // Reserved — the daily rollup leaves these NULL until their inputs exist, and
    // the UI does NOT surface them while unpopulated (no fabricated metrics):
    //   cac / roas → need ad-spend data (this product is organic-social, no spend
    //   source yet); ltv → needs long-horizon per-customer revenue tracking.
    cac: numeric('cac'),
    roas: numeric('roas'),
    ltv: numeric('ltv'),
    followers: integer('followers'),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.day] })],
);
