import type {
  EngineSignal,
  WorkflowDefinition,
  WorkflowStep,
  WorkflowTrigger,
} from './types';

/**
 * Pure orchestration logic for the Automation Engine. No I/O, no db, no module
 * imports — just trigger matching and step planning so it can be tested
 * exhaustively. `AutomationEngine` composes these helpers around persistence.
 */

/**
 * Decide whether a workflow trigger fires for a given signal. Only `signal`
 * triggers can match a signal; `schedule` triggers are driven by the worker's
 * cron and never match here.
 */
export function triggerMatches(trigger: WorkflowTrigger, signal: EngineSignal): boolean {
  if (!trigger || typeof trigger !== 'object') return false;
  if (trigger.type !== 'signal') return false;
  const wanted = trigger.match?.type;
  return typeof wanted === 'string' && wanted === signal.type;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Coerce a raw jsonb `definition` into a validated, ordered step list. Steps
 * missing a `key` or `action` are dropped defensively; never throws.
 */
export function planSteps(definition: unknown): WorkflowStep[] {
  if (!isRecord(definition)) return [];
  const rawSteps = definition.steps;
  if (!Array.isArray(rawSteps)) return [];

  const steps: WorkflowStep[] = [];
  for (const raw of rawSteps) {
    if (!isRecord(raw)) continue;
    const key = asString(raw.key);
    const action = asString(raw.action);
    if (!key || !action) continue;
    steps.push({
      key,
      action,
      ...(isRecord(raw.input) ? { input: raw.input } : {}),
      ...(raw.requiresApproval === true ? { requiresApproval: true } : {}),
    });
  }
  return steps;
}

/** Normalize a possibly-partial definition into a concrete `WorkflowDefinition`. */
export function normalizeDefinition(definition: unknown): WorkflowDefinition {
  return { steps: planSteps(definition) };
}

/** True when the step must be gated behind a human approval before running. */
export function stepNeedsApproval(step: WorkflowStep): boolean {
  return step.requiresApproval === true;
}

/**
 * Merge an action's output into the accumulated run context immutably. Later
 * keys win; the inputs are never mutated (keeps step execution side-effect free
 * at the data level).
 */
export function mergeRunContext(
  runContext: Record<string, unknown>,
  output: Record<string, unknown>,
): Record<string, unknown> {
  return { ...runContext, ...output };
}
