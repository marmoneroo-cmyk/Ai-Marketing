import { pgTable, uuid, text, numeric, timestamp, index } from 'drizzle-orm/pg-core';
import type { ApprovalKind } from '@brandpilot/core';
import { primaryId } from './_shared';
import { users, orgRef } from './identity';

/** Approvals & Owner Tasks: the human-in-the-loop surfaces on the dashboard. */

export const approvals = pgTable(
  'approvals',
  {
    id: primaryId(),
    orgId: orgRef(),
    kind: text('kind').$type<ApprovalKind>().notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    requestedBy: text('requested_by'), // agent / user
    summary: text('summary'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    status: text('status')
      .$type<'pending' | 'approved' | 'rejected' | 'expired'>()
      .notNull()
      .default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('approvals_org_status_created_idx').on(t.orgId, t.status, t.createdAt)],
);

export const ownerTasks = pgTable('owner_tasks', {
  id: primaryId(),
  orgId: orgRef(),
  title: text('title').notNull(),
  detail: text('detail'),
  priority: text('priority').$type<'low' | 'normal' | 'high'>().notNull().default('normal'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  status: text('status').$type<'open' | 'done' | 'dismissed'>().notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
