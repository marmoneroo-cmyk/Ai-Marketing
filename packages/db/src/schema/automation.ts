import { pgTable, uuid, text, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { primaryId } from './_shared';
import { orgRef } from './identity';
import { signals } from './brain-episodic';

/** Automation Engine: signal/schedule-triggered workflows and their run/step history. */

export const workflows = pgTable(
  'workflows',
  {
    id: primaryId(),
    orgId: orgRef(),
    name: text('name').notNull(),
    // { type:'signal', match:{type:'lead_created'} } | { type:'schedule', cron:'0 8 * * 1' }
    // (signal `match.type` must be a real emitted SignalType — e.g. lead_created,
    // appointment_booked, post_published — not an aspirational one like 'comment'.)
    trigger: jsonb('trigger').notNull(),
    definition: jsonb('definition').notNull(), // ordered steps (DAG) with guardrails & approval flags
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // handleSignal + workflow tick select enabled workflows per org.
  (t) => [index('workflows_org_enabled_idx').on(t.orgId, t.enabled)],
);

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: primaryId(),
    orgId: orgRef(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    triggerSignalId: uuid('trigger_signal_id').references(() => signals.id),
    status: text('status')
      .$type<'running' | 'waiting_approval' | 'done' | 'failed' | 'canceled'>()
      .notNull()
      .default('running'),
    context: jsonb('context').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    // Idempotent signal -> run: a redelivered/retried automation-signal job
    // must never start a second run for the same (workflow, signal) — that
    // would re-execute every side-effecting step of the run. Partial so the
    // many schedule-triggered runs (triggerSignalId IS NULL) stay unconstrained.
    uniqueIndex('workflow_runs_workflow_signal_uq')
      .on(t.workflowId, t.triggerSignalId)
      .where(sql`${t.triggerSignalId} is not null`),
  ],
);

export const workflowStepRuns = pgTable(
  'workflow_step_runs',
  {
    id: primaryId(),
    orgId: orgRef(),
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    stepKey: text('step_key').notNull(),
    status: text('status')
      .$type<'pending' | 'running' | 'success' | 'skipped' | 'error' | 'awaiting_approval'>()
      .notNull(),
    input: jsonb('input'),
    output: jsonb('output'),
    error: jsonb('error'),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Resume rebuilds run progress from its step runs, filtered by (orgId, runId)
  // and ordered by ranAt.
  (t) => [index('workflow_step_runs_org_run_ran_idx').on(t.orgId, t.runId, t.ranAt)],
);
