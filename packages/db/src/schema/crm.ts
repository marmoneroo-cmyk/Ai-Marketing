import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  unique,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId } from './_shared';
import { users, orgRef } from './identity';

/** CRM & Leads: contacts, a configurable pipeline, leads, activity log, and deals. */

export const contacts = pgTable(
  'contacts',
  {
    id: primaryId(),
    orgId: orgRef(),
    name: text('name'),
    email: text('email'),
    phone: text('phone'),
    handles: jsonb('handles').notNull().default({}), // { instagram, tiktok, ... }
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('contacts_org_email_idx').on(t.orgId, t.email),
    // Dedup + concurrency-safety for social contacts: unique per (org, social
    // handle), partial so name/email-only contacts stay unconstrained. Also
    // indexes ConversationEngine.resolveContact's handle lookup (was a scan).
    uniqueIndex('contacts_org_social_uq')
      .on(t.orgId, sql`(${t.handles} ->> 'social')`)
      .where(sql`${t.handles} ->> 'social' IS NOT NULL`),
  ],
);

export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: primaryId(),
    orgId: orgRef(),
    position: integer('position').notNull(),
    name: text('name').notNull(),
  },
  (t) => [unique('pipeline_stages_org_position_uq').on(t.orgId, t.position)],
);

export const leads = pgTable(
  'leads',
  {
    id: primaryId(),
    orgId: orgRef(),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    source: text('source').$type<'comment' | 'dm' | 'form' | 'discovery' | 'manual'>(),
    score: numeric('score', { precision: 4, scale: 3 }), // qualification score
    status: text('status')
      .$type<'new' | 'qualified' | 'unqualified' | 'nurturing' | 'converted' | 'lost'>()
      .notNull()
      .default('new'),
    stageId: uuid('stage_id').references(() => pipelineStages.id),
    intentEstimate: numeric('intent_estimate', { precision: 4, scale: 3 }),
    ownerId: uuid('owner_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Leads list is scoped by org and ordered newest-first.
    index('leads_org_created_idx').on(t.orgId, t.createdAt),
    // ConversationEngine.ensureLead dedups by (org, contact) on every inbound msg.
    // UNIQUE so a concurrent double-inbound can't insert two leads for the same
    // contact (the constraint's index also serves the dedup lookup). Postgres keeps
    // NULL contactId rows distinct, so contactless leads are unaffected.
    unique('leads_org_contact_uq').on(t.orgId, t.contactId),
  ],
);

export const leadActivities = pgTable('lead_activities', {
  id: primaryId(),
  orgId: orgRef(),
  leadId: uuid('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'cascade' }),
  kind: text('kind')
    .$type<'note' | 'status_change' | 'message' | 'meeting' | 'followup'>()
    .notNull(),
  body: text('body'),
  actorType: text('actor_type'), // user / agent
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const deals = pgTable(
  'deals',
  {
    id: primaryId(),
    orgId: orgRef(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    title: text('title'),
    amount: numeric('amount', { precision: 12, scale: 2 }),
    currency: text('currency'),
    stageId: uuid('stage_id').references(() => pipelineStages.id),
    status: text('status').$type<'open' | 'won' | 'lost'>().notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Leads list left-joins deals on leadId.
    index('deals_lead_idx').on(t.leadId),
    // /leads/summary aggregates deal value by (org, status).
    index('deals_org_status_idx').on(t.orgId, t.status),
  ],
);
