import { pgTable, text, numeric, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { primaryId } from './_shared';
import { orgRef } from './identity';

/**
 * AI Optimization: A/B and pattern experiments. Recommendations reuse `insights`
 * (kind = 'recommendation') with its own status lifecycle.
 */

export const experiments = pgTable('experiments', {
  id: primaryId(),
  orgId: orgRef(),
  hypothesis: text('hypothesis').notNull(),
  variable: text('variable'), // e.g. hook, cta, post_time, format
  variants: jsonb('variants').notNull().default([]),
  status: text('status')
    .$type<'running' | 'concluded' | 'aborted'>()
    .notNull()
    .default('running'),
  result: jsonb('result'),
  confidence: numeric('confidence', { precision: 4, scale: 3 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
