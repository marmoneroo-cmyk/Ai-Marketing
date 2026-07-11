import { timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Column-builder helpers. These are FUNCTIONS (not shared instances) because
 * Drizzle column builders are stateful and must not be reused across tables.
 */
export const primaryId = () => uuid('id').primaryKey().defaultRandom();

export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
