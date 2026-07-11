import type { SignalType } from '@brandpilot/core';

/**
 * Workflow shapes stored in `workflows.trigger` / `workflows.definition` (jsonb).
 * These are the decoupled contract between the Automation Engine and the worker
 * that wires real module methods to action names — the engine never imports a
 * domain module.
 */

/** Fires a workflow when a matching signal is recorded in episodic memory. */
export interface SignalTrigger {
  type: 'signal';
  match: { type: SignalType };
}

/** Fires a workflow on a cron schedule (evaluated by the worker, not the engine). */
export interface ScheduleTrigger {
  type: 'schedule';
  cron: string;
}

export type WorkflowTrigger = SignalTrigger | ScheduleTrigger;

/** One ordered unit of work in a workflow. `action` is resolved via the registry. */
export interface WorkflowStep {
  key: string;
  action: string;
  input?: Record<string, unknown>;
  requiresApproval?: boolean;
}

/** The ordered step plan stored in `workflows.definition`. */
export interface WorkflowDefinition {
  steps: WorkflowStep[];
}

/** Input to `registerWorkflow` — the persisted workflow spec. */
export interface WorkflowSpec {
  name: string;
  trigger: WorkflowTrigger;
  definition: WorkflowDefinition;
  enabled?: boolean;
}

/** A signal handed to `handleSignal` (the trigger source for the engine). */
export interface EngineSignal {
  /**
   * The persisted `signals.id` this came from, when the caller has it. Threaded
   * through into `workflowRuns.triggerSignalId` so a redelivered/retried signal
   * job can't start a second run for the same workflow — see
   * `AutomationEngine.runWorkflow`. Optional: not every signal source can
   * supply a durable id yet.
   */
  id?: string;
  type: SignalType;
  payload?: Record<string, unknown>;
}

/**
 * An injected action implementation. The worker maps action names to real module
 * methods; the engine only knows this shape, keeping it fully decoupled.
 */
export type ActionHandler = (ctx: {
  orgId: string;
  input: Record<string, unknown>;
  runContext: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

export interface RegisterWorkflowResult {
  workflowId: string;
}

export interface HandleSignalResult {
  runsStarted: number;
}

export interface RunWorkflowResult {
  runId: string;
  status: string;
}

export type { SignalType };
