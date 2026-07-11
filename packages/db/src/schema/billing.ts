import { pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { primaryId } from './_shared';
import { orgRef } from './identity';

/**
 * SaaS subscription state — the org paying US. Deliberately distinct from
 * `payment_links` (sales.ts), which tracks the org's CUSTOMERS paying the org.
 * Written only by the (gated) Stripe subscription webhook/checkout flow.
 */

export const billingSubscriptions = pgTable(
  'billing_subscriptions',
  {
    id: primaryId(),
    orgId: orgRef(),
    provider: text('provider').notNull().default('stripe'),
    externalCustomerId: text('external_customer_id'),
    externalSubscriptionId: text('external_subscription_id'),
    status: text('status')
      .$type<'active' | 'past_due' | 'canceled' | 'trialing'>()
      .notNull()
      .default('active'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // One subscription row per org.
  (t) => [unique('billing_subscriptions_org_uq').on(t.orgId)],
);
