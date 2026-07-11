import { pgTable, uuid, text, integer, numeric, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId } from './_shared';
import { organizations, orgRef } from './identity';

/**
 * Business Brain — derived intelligence. Recomputed periodically from the
 * structured, semantic, and episodic layers.
 */

// One voice profile per org: the PK IS the org id.
export const brandVoiceProfiles = pgTable('brand_voice_profiles', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  personality: jsonb('personality').notNull().default({}),
  tone: jsonb('tone').notNull().default({}),
  vocabulary: jsonb('vocabulary').notNull().default({}), // preferred / avoid words
  emojiUsage: jsonb('emoji_usage').notNull().default({}),
  sentenceStats: jsonb('sentence_stats').notNull().default({}), // avg length, rhythm
  doExamples: text('do_examples').array().notNull().default(sql`'{}'::text[]`),
  dontExamples: text('dont_examples').array().notNull().default(sql`'{}'::text[]`),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('0'),
  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
});

export const audienceSegments = pgTable('audience_segments', {
  id: primaryId(),
  orgId: orgRef(),
  name: text('name').notNull(),
  criteria: jsonb('criteria').notNull().default({}),
  sizeEstimate: integer('size_estimate'),
  interests: text('interests').array().notNull().default(sql`'{}'::text[]`),
  sentiment: numeric('sentiment'),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('0'),
  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
});

export const insights = pgTable(
  'insights',
  {
    id: primaryId(),
    orgId: orgRef(),
    module: text('module').notNull(),
    kind: text('kind').$type<'pattern' | 'recommendation' | 'anomaly' | 'forecast'>().notNull(),
    title: text('title').notNull(),
    body: text('body'),
    evidence: jsonb('evidence').notNull().default({}), // signal / chunk refs
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('0'),
    status: text('status')
      .$type<'new' | 'accepted' | 'dismissed' | 'applied'>()
      .notNull()
      .default('new'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Dashboard buildRecommendations filters (orgId, kind) ORDER BY createdAt DESC LIMIT 5.
  // No index existed on this table at all before this.
  (t) => [index('insights_org_kind_created_idx').on(t.orgId, t.kind, t.createdAt)],
);
