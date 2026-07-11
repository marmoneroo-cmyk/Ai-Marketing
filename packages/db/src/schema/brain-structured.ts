import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  jsonb,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId, timestamps } from './_shared';
import { organizations, orgRef } from './identity';

/**
 * Business Brain — structured knowledge. These tables answer *precise* questions
 * (products, pricing, personas, policies) as opposed to the fuzzy semantic memory.
 */

// One canonical profile per org: the PK IS the org id.
export const businessProfiles = pgTable('business_profiles', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  legalName: text('legal_name'),
  description: text('description'),
  mission: text('mission'),
  vision: text('vision'),
  usp: text('usp'),
  valueProps: jsonb('value_props').notNull().default([]),
  contact: jsonb('contact').notNull().default({}), // phone, email, address, hours
  websiteUrl: text('website_url'),
  categories: text('categories').array().notNull().default(sql`'{}'::text[]`),
  completeness: numeric('completeness', { precision: 4, scale: 3 }).notNull().default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const products = pgTable('products', {
  id: primaryId(),
  orgId: orgRef(),
  name: text('name').notNull(),
  description: text('description'),
  price: numeric('price', { precision: 12, scale: 2 }),
  currency: text('currency'),
  sku: text('sku'),
  attributes: jsonb('attributes').notNull().default({}),
  active: boolean('active').notNull().default(true),
  source: text('source').$type<'discovery' | 'upload' | 'manual'>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const services = pgTable('services', {
  id: primaryId(),
  orgId: orgRef(),
  name: text('name').notNull(),
  description: text('description'),
  durationMin: integer('duration_min'),
  price: numeric('price', { precision: 12, scale: 2 }),
  currency: text('currency'),
  bookable: boolean('bookable').notNull().default(false),
  attributes: jsonb('attributes').notNull().default({}),
  active: boolean('active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const pricingPlans = pgTable('pricing_plans', {
  id: primaryId(),
  orgId: orgRef(),
  name: text('name').notNull(),
  price: numeric('price', { precision: 12, scale: 2 }),
  currency: text('currency'),
  billing: text('billing').$type<'one_time' | 'monthly' | 'yearly' | 'custom'>(),
  includes: jsonb('includes').notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const customerPersonas = pgTable('customer_personas', {
  id: primaryId(),
  orgId: orgRef(),
  name: text('name').notNull(),
  demographics: jsonb('demographics').notNull().default({}),
  goals: text('goals').array().notNull().default(sql`'{}'::text[]`),
  painPoints: text('pain_points').array().notNull().default(sql`'{}'::text[]`),
  buyingTriggers: text('buying_triggers').array().notNull().default(sql`'{}'::text[]`),
  objections: text('objections').array().notNull().default(sql`'{}'::text[]`),
  channels: text('channels').array().notNull().default(sql`'{}'::text[]`),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('0'),
  source: text('source').$type<'discovery' | 'derived' | 'manual'>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const competitors = pgTable('competitors', {
  id: primaryId(),
  orgId: orgRef(),
  name: text('name').notNull(),
  handles: jsonb('handles').notNull().default({}),
  websiteUrl: text('website_url'),
  positioning: text('positioning'),
  strengths: text('strengths').array().notNull().default(sql`'{}'::text[]`),
  weaknesses: text('weaknesses').array().notNull().default(sql`'{}'::text[]`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// One brand kit per org: the PK IS the org id.
export const brandKits = pgTable('brand_kits', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  colors: jsonb('colors').notNull().default([]), // [{ hex, role }]
  fonts: jsonb('fonts').notNull().default([]),
  logoAssetId: uuid('logo_asset_id'), // FK to brand_assets (soft link, no constraint)
  designNotes: text('design_notes'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const brandAssets = pgTable('brand_assets', {
  id: primaryId(),
  orgId: orgRef(),
  kind: text('kind').$type<'logo' | 'image' | 'video' | 'font' | 'document'>().notNull(),
  storageKey: text('storage_key').notNull(),
  mime: text('mime'),
  width: integer('width'),
  height: integer('height'),
  meta: jsonb('meta').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const faqs = pgTable('faqs', {
  id: primaryId(),
  orgId: orgRef(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  approved: boolean('approved').notNull().default(false),
  source: text('source'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const policies = pgTable('policies', {
  id: primaryId(),
  orgId: orgRef(),
  kind: text('kind').notNull(),
  body: text('body').notNull(),
  approved: boolean('approved').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const offers = pgTable('offers', {
  id: primaryId(),
  orgId: orgRef(),
  name: text('name').notNull(),
  details: text('details'),
  discount: jsonb('discount'), // { type, value }
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
});

export const salesProcessStages = pgTable(
  'sales_process_stages',
  {
    id: primaryId(),
    orgId: orgRef(),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    guidance: text('guidance'),
  },
  (t) => [unique('sales_process_stages_org_position_uq').on(t.orgId, t.position)],
);

export const testimonials = pgTable('testimonials', {
  id: primaryId(),
  orgId: orgRef(),
  author: text('author'),
  body: text('body').notNull(),
  rating: integer('rating'),
  source: text('source'),
  approved: boolean('approved').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const objections = pgTable('objections', {
  id: primaryId(),
  orgId: orgRef(),
  objection: text('objection').notNull(),
  rebuttal: text('rebuttal'),
  approved: boolean('approved').notNull().default(false),
});

export const onboardingAnswers = pgTable(
  'onboarding_answers',
  {
    id: primaryId(),
    orgId: orgRef(),
    questionKey: text('question_key').notNull(),
    answer: jsonb('answer').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('onboarding_answers_org_question_uq').on(t.orgId, t.questionKey)],
);
