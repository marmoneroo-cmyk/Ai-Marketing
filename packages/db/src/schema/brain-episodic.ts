import { pgTable, uuid, text, jsonb, numeric, timestamp, index } from 'drizzle-orm/pg-core';
import type { SignalType } from '@brandpilot/core';
import { primaryId } from './_shared';
import { orgRef } from './identity';

/**
 * Episodic memory: the append-only stream of everything that happened. It is
 * both the learning substrate (Layer 3) and the trigger source for the
 * Automation Engine. Partition by month at scale.
 */
export const signals = pgTable(
  'signals',
  {
    id: primaryId(),
    orgId: orgRef(),
    type: text('type').$type<SignalType>().notNull(),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    payload: jsonb('payload').notNull().default({}),
    value: numeric('value'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('signals_org_type_time_idx').on(t.orgId, t.type, t.occurredAt)],
);
