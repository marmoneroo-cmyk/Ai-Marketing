import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '@brandpilot/db';
import { workflows, workflowRuns, workflowStepRuns, approvals } from '@brandpilot/db';
import { logger, captureError } from '@brandpilot/observability';
import type {
  ActionHandler,
  EngineSignal,
  HandleSignalResult,
  RegisterWorkflowResult,
  RunWorkflowResult,
  WorkflowSpec,
  WorkflowStep,
  WorkflowTrigger,
} from './types';
import {
  mergeRunContext,
  normalizeDefinition,
  planSteps,
  stepNeedsApproval,
  triggerMatches,
} from './workflow-runtime';
import { DEFAULT_WORKFLOW_SPECS } from './default-workflows';

const ACTOR_ID = 'automation-engine';

export interface AutomationDeps {
  db: Database;
  /**
   * Injected action registry. The worker wires real domain-module methods to
   * action names so the engine stays fully decoupled — it never imports a
   * module directly.
   */
  actions: Record<string, ActionHandler>;
}

/**
 * Module 5 — the Automation Engine. Executes signal/schedule-triggered workflows
 * as ordered step plans, threading a run context across steps and halting on
 * human-approval gates. Orchestration only: every side-effecting action is
 * resolved through the injected registry, never by importing a domain module.
 */
export class AutomationEngine {
  private readonly deps: AutomationDeps;

  constructor(deps: AutomationDeps) {
    this.deps = deps;
  }

  /** Persist a new workflow definition for an org. */
  async registerWorkflow(orgId: string, wf: WorkflowSpec): Promise<RegisterWorkflowResult> {
    const [row] = await this.deps.db
      .insert(workflows)
      .values({
        orgId,
        name: wf.name,
        trigger: wf.trigger,
        definition: normalizeDefinition(wf.definition),
        ...(wf.enabled === undefined ? {} : { enabled: wf.enabled }),
      })
      .returning();

    return { workflowId: row?.id ?? '' };
  }

  /**
   * Idempotently install the default workflow set for an org so the autonomous
   * loop works out-of-the-box. For each spec, a workflow with the same `name` is
   * registered only if one does not already exist for the org — safe to call on
   * every org setup / discovery run. Returns how many were newly created.
   */
  async seedDefaultWorkflows(orgId: string): Promise<{ seeded: number }> {
    let seeded = 0;
    for (const spec of DEFAULT_WORKFLOW_SPECS) {
      const [existing] = await this.deps.db
        .select({ id: workflows.id })
        .from(workflows)
        .where(and(eq(workflows.orgId, orgId), eq(workflows.name, spec.name)))
        .limit(1);
      if (existing) continue;
      await this.registerWorkflow(orgId, spec);
      seeded++;
    }
    return { seeded };
  }

  /**
   * Fan a recorded signal out to every enabled workflow whose trigger matches,
   * starting one run per match. Matching is delegated to the pure
   * `triggerMatches` helper.
   *
   * Each match is isolated in its own try/catch (mirrors the scheduler's
   * per-item isolation in `runWorkflowTick`): one workflow's failure — a DB
   * blip, a bad definition — must never abort the run for its siblings, and
   * must never abort/fail the whole `automation.signal` job (which would
   * requeue a retry that re-runs every ALREADY-succeeded sibling too).
   */
  async handleSignal(orgId: string, signal: EngineSignal): Promise<HandleSignalResult> {
    const candidates = await this.deps.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.orgId, orgId), eq(workflows.enabled, true)));

    let runsStarted = 0;
    for (const wf of candidates) {
      if (!triggerMatches(wf.trigger as WorkflowTrigger, signal)) continue;
      try {
        await this.runWorkflow(orgId, wf.id, signal.payload ?? {}, signal.id);
        runsStarted++;
      } catch (err) {
        logger.error(
          { err, orgId, workflowId: wf.id, signalId: signal.id },
          'signal-triggered workflow run failed',
        );
        captureError(err, { orgId, workflowId: wf.id, signalId: signal.id });
      }
    }

    return { runsStarted };
  }

  /**
   * Execute a workflow's steps in order. Threads a `runContext` across steps,
   * merging each action's output. Halts (status `waiting_approval`) at the first
   * approval-gated step, records `error` + `failed` on a thrown action or a
   * missing action handler, and marks the run `done` when all steps succeed.
   *
   * `triggerSignalId` (when the caller has a persisted `signals.id`) makes a
   * signal-triggered run idempotent: a redelivered/retried `automation.signal`
   * job must never start a SECOND run — and re-execute every side-effecting
   * step — for the same (workflow, signal). Schedule-triggered callers (the
   * scheduler's `runWorkflowTick`) omit it and are never deduped this way.
   */
  async runWorkflow(
    orgId: string,
    workflowId: string,
    triggerPayload: Record<string, unknown>,
    triggerSignalId?: string,
  ): Promise<RunWorkflowResult> {
    const { db } = this.deps;

    const [wf] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.orgId, orgId), eq(workflows.id, workflowId)))
      .limit(1);
    if (!wf) throw new Error(`Workflow ${workflowId} not found`);

    // Fast path: a prior delivery for this signal already has a run — no-op
    // instead of starting a duplicate. `onConflictDoNothing` below is the race
    // backstop for two concurrent deliveries landing at (almost) the same time.
    if (triggerSignalId) {
      const existing = await this.findRunBySignal(workflowId, triggerSignalId);
      if (existing) return existing;
    }

    const [run] = await db
      .insert(workflowRuns)
      .values({
        orgId,
        workflowId,
        status: 'running',
        context: triggerPayload,
        ...(triggerSignalId ? { triggerSignalId } : {}),
      })
      // Targets `workflow_runs_workflow_signal_uq` (packages/db/schema/automation.ts).
      // The `where` predicate must match the index's partial predicate exactly
      // for Postgres to recognize it as the arbiter; it's a no-op for
      // schedule-triggered inserts (triggerSignalId NULL rows are never in the
      // partial index, so they can never conflict against it).
      .onConflictDoNothing({
        target: [workflowRuns.workflowId, workflowRuns.triggerSignalId],
        where: sql`${workflowRuns.triggerSignalId} is not null`,
      })
      .returning();

    if (!run) {
      // Lost the race: a concurrent delivery for the same signal won the
      // insert. Return ITS run instead of proceeding with an undefined id.
      const existing = triggerSignalId ? await this.findRunBySignal(workflowId, triggerSignalId) : null;
      if (existing) return existing;
      throw new Error(`Failed to create workflow run for workflow ${workflowId}`);
    }

    const runId = run.id;
    const steps = planSteps(wf.definition);
    return this.executeFrom(orgId, runId, workflowId, steps, 0, { ...triggerPayload }, false);
  }

  /** Look up an already-started run for a (workflow, signal) pair, if any. */
  private async findRunBySignal(
    workflowId: string,
    triggerSignalId: string,
  ): Promise<RunWorkflowResult | null> {
    const [existing] = await this.deps.db
      .select({ id: workflowRuns.id, status: workflowRuns.status })
      .from(workflowRuns)
      .where(
        and(eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.triggerSignalId, triggerSignalId)),
      )
      .limit(1);
    return existing ? { runId: existing.id, status: existing.status } : null;
  }

  /**
   * Resume a run halted at an approval gate. When `approved`, continues the
   * remaining steps from the halt point (rehydrating run context from prior
   * successful steps); otherwise cancels the run. The worker calls this after
   * an approval decision — signature is part of the enqueue/worker contract.
   */
  async resumeRun(
    orgId: string,
    runId: string,
    approved: boolean,
  ): Promise<{ runId: string; status: string }> {
    const { db } = this.deps;

    // Rejection: atomically cancel, but only if the run is still parked at the
    // gate. If the UPDATE claims 0 rows, another delivery already resolved it.
    if (!approved) {
      const [canceled] = await db
        .update(workflowRuns)
        .set({ status: 'canceled', finishedAt: new Date() })
        .where(
          and(
            eq(workflowRuns.orgId, orgId),
            eq(workflowRuns.id, runId),
            eq(workflowRuns.status, 'waiting_approval'),
          ),
        )
        .returning();
      return { runId, status: canceled ? 'canceled' : await this.currentStatus(orgId, runId) };
    }

    // Approval: atomically CLAIM the run (waiting_approval → running). Only one
    // concurrent/retried resume can win the UPDATE; losers claim 0 rows and are
    // idempotent no-ops — this is what prevents the gated (side-effecting)
    // action from being executed twice. Mirrors the scheduler's post-claim.
    const [run] = await db
      .update(workflowRuns)
      .set({ status: 'running' })
      .where(
        and(
          eq(workflowRuns.orgId, orgId),
          eq(workflowRuns.id, runId),
          eq(workflowRuns.status, 'waiting_approval'),
        ),
      )
      .returning();
    if (!run) return { runId, status: await this.currentStatus(orgId, runId) };

    const [wf] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.orgId, orgId), eq(workflows.id, run.workflowId)))
      .limit(1);
    if (!wf) throw new Error(`Workflow ${run.workflowId} not found`);

    const steps = planSteps(wf.definition);

    // Rebuild progress from recorded step runs: successful steps are done, and
    // the awaiting_approval step is where we resume (its action still runs).
    const stepRuns = await db
      .select()
      .from(workflowStepRuns)
      .where(and(eq(workflowStepRuns.orgId, orgId), eq(workflowStepRuns.runId, runId)))
      .orderBy(asc(workflowStepRuns.ranAt));

    const completedKeys = new Set(
      stepRuns.filter((s) => s.status === 'success').map((s) => s.stepKey),
    );
    const resumeIndex = steps.findIndex((s) => !completedKeys.has(s.key));

    // No remaining steps → the run is already effectively complete.
    if (resumeIndex < 0) {
      await this.setRunStatus(runId, 'done', new Date());
      return { runId, status: 'done' };
    }

    // Rehydrate the run context: trigger payload + every prior successful output.
    let runContext = isRecord(run.context) ? { ...run.context } : {};
    for (const sr of stepRuns) {
      if (sr.status === 'success' && isRecord(sr.output)) {
        runContext = mergeRunContext(runContext, sr.output);
      }
    }

    return this.executeFrom(orgId, runId, run.workflowId, steps, resumeIndex, runContext, true);
  }

  /** Best-effort current status read, for idempotent no-op resume paths. */
  private async currentStatus(orgId: string, runId: string): Promise<string> {
    const [row] = await this.deps.db
      .select({ status: workflowRuns.status })
      .from(workflowRuns)
      .where(and(eq(workflowRuns.orgId, orgId), eq(workflowRuns.id, runId)))
      .limit(1);
    return row?.status ?? 'not_found';
  }

  /**
   * Execute `steps` from `startIndex`, threading `runContext`. Halts at the
   * first approval-gated step (unless `skipFirstApprovalGate` is set — used on
   * resume so the just-approved step runs instead of re-gating). Shared by
   * `runWorkflow` and `resumeRun` so step semantics stay identical.
   */
  private async executeFrom(
    orgId: string,
    runId: string,
    workflowId: string,
    steps: WorkflowStep[],
    startIndex: number,
    initialContext: Record<string, unknown>,
    skipFirstApprovalGate: boolean,
  ): Promise<RunWorkflowResult> {
    let runContext = initialContext;

    for (let i = startIndex; i < steps.length; i++) {
      const step = steps[i];
      if (!step) continue;
      const isResumedGate = skipFirstApprovalGate && i === startIndex;

      if (stepNeedsApproval(step) && !isResumedGate) {
        await this.requestApproval(orgId, runId, workflowId, step);
        await this.recordStep(orgId, runId, step, 'awaiting_approval', { input: step.input ?? {} });
        await this.setRunStatus(runId, 'waiting_approval');
        return { runId, status: 'waiting_approval' };
      }

      const handler = this.deps.actions[step.action];
      if (!handler) {
        await this.recordStep(orgId, runId, step, 'error', {
          input: step.input ?? {},
          error: { message: `No action handler registered for "${step.action}"` },
        });
        await this.setRunStatus(runId, 'failed');
        return { runId, status: 'failed' };
      }

      // Merge the run context (which carries the trigger/signal payload, e.g. a
      // `lead_created` signal's `{ leadId }`) UNDER the static `step.input` so a
      // signal's fields reach the action while explicit step config still wins.
      const input = { ...runContext, ...(step.input ?? {}) };
      try {
        const output = await handler({ orgId, input, runContext });
        await this.recordStep(orgId, runId, step, 'success', { input, output });
        runContext = mergeRunContext(runContext, output);
      } catch (err) {
        await this.recordStep(orgId, runId, step, 'error', {
          input,
          error: { message: errorMessage(err) },
        });
        await this.setRunStatus(runId, 'failed');
        return { runId, status: 'failed' };
      }
    }

    await this.setRunStatus(runId, 'done', new Date());
    return { runId, status: 'done' };
  }

  private async requestApproval(
    orgId: string,
    runId: string,
    workflowId: string,
    step: WorkflowStep,
  ): Promise<void> {
    await this.deps.db.insert(approvals).values({
      orgId,
      kind: 'workflow',
      targetType: 'workflow_run',
      targetId: runId,
      requestedBy: ACTOR_ID,
      summary: `Step "${step.key}" of workflow ${workflowId} requires approval before "${step.action}".`,
      status: 'pending',
    });
  }

  private async recordStep(
    orgId: string,
    runId: string,
    step: WorkflowStep,
    status: 'success' | 'error' | 'awaiting_approval',
    payload: { input: Record<string, unknown>; output?: Record<string, unknown>; error?: Record<string, unknown> },
  ): Promise<void> {
    await this.deps.db.insert(workflowStepRuns).values({
      orgId,
      runId,
      stepKey: step.key,
      status,
      input: payload.input,
      ...(payload.output === undefined ? {} : { output: payload.output }),
      ...(payload.error === undefined ? {} : { error: payload.error }),
    });
  }

  private async setRunStatus(
    runId: string,
    status: 'running' | 'waiting_approval' | 'done' | 'failed' | 'canceled',
    finishedAt?: Date,
  ): Promise<void> {
    if (!runId) return;
    await this.deps.db
      .update(workflowRuns)
      .set({ status, ...(finishedAt ? { finishedAt } : {}) })
      .where(eq(workflowRuns.id, runId));
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Narrow an unknown jsonb value to a plain record for safe context rehydration. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
