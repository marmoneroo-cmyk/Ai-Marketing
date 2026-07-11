import { pgTable, uuid, text, numeric, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { primaryId } from './_shared';
import { orgRef } from './identity';
import { contacts, deals } from './crm';

/** Sales: AI-generated proposals, quotes with line items, and payment links. */

export const proposals = pgTable('proposals', {
  id: primaryId(),
  orgId: orgRef(),
  contactId: uuid('contact_id').references(() => contacts.id),
  dealId: uuid('deal_id').references(() => deals.id),
  body: jsonb('body').notNull().default({}), // generated sections
  status: text('status')
    .$type<'draft' | 'sent' | 'accepted' | 'rejected'>()
    .notNull()
    .default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const quotes = pgTable('quotes', {
  id: primaryId(),
  orgId: orgRef(),
  proposalId: uuid('proposal_id').references(() => proposals.id, { onDelete: 'set null' }),
  lineItems: jsonb('line_items').notNull().default([]),
  subtotal: numeric('subtotal', { precision: 12, scale: 2 }),
  total: numeric('total', { precision: 12, scale: 2 }),
  currency: text('currency'),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  status: text('status')
    .$type<'draft' | 'sent' | 'accepted' | 'expired'>()
    .notNull()
    .default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const paymentLinks = pgTable('payment_links', {
  id: primaryId(),
  orgId: orgRef(),
  quoteId: uuid('quote_id').references(() => quotes.id, { onDelete: 'set null' }),
  provider: text('provider').notNull().default('stripe'),
  externalId: text('external_id'),
  url: text('url'),
  amount: numeric('amount', { precision: 12, scale: 2 }),
  currency: text('currency'),
  status: text('status')
    .$type<'created' | 'paid' | 'expired' | 'canceled'>()
    .notNull()
    .default('created'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
