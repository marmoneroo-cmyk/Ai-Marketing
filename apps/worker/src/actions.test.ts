import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKFLOW_SPECS } from '@brandpilot/automation';
import { buildActionRegistry, type ActionEngines } from './actions';

/**
 * Cross-package contract guard. The Automation Engine (packages/automation) seeds
 * default workflows that reference actions by NAME; the worker (apps/worker) binds
 * those names to real module methods in its registry. If a seeded workflow ever
 * references an action the registry doesn't define, that step dies at run time and
 * nothing else catches it — this test does. Handlers are never invoked here (we
 * only read the registry's keys), so a bare stub for the engines is safe.
 */
describe('default workflows ↔ action registry contract', () => {
  const registryKeys = new Set(
    Object.keys(buildActionRegistry({} as unknown as ActionEngines)),
  );

  it('registers a handler for every action used by DEFAULT_WORKFLOW_SPECS', () => {
    const referenced = DEFAULT_WORKFLOW_SPECS.flatMap((spec) =>
      spec.definition.steps.map((step) => step.action),
    );
    const missing = referenced.filter((action) => !registryKeys.has(action));

    expect(missing).toEqual([]);
  });

  it('has a non-empty registry and specs (guards against a broken import)', () => {
    expect(registryKeys.size).toBeGreaterThan(0);
    expect(DEFAULT_WORKFLOW_SPECS.length).toBeGreaterThan(0);
  });
});
