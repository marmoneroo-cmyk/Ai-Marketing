import { describe, expect, it } from 'vitest';
import {
  mergeRunContext,
  normalizeDefinition,
  planSteps,
  stepNeedsApproval,
  triggerMatches,
} from './workflow-runtime';
import type { EngineSignal, WorkflowTrigger } from './types';

describe('triggerMatches', () => {
  it('matches a signal trigger whose match.type equals the signal type', () => {
    // Arrange
    const trigger: WorkflowTrigger = { type: 'signal', match: { type: 'comment' } };
    const signal: EngineSignal = { type: 'comment', payload: { text: 'hi' } };

    // Act & Assert
    expect(triggerMatches(trigger, signal)).toBe(true);
  });

  it('does not match when the signal type differs', () => {
    // Arrange
    const trigger: WorkflowTrigger = { type: 'signal', match: { type: 'comment' } };
    const signal: EngineSignal = { type: 'sale' };

    // Act & Assert
    expect(triggerMatches(trigger, signal)).toBe(false);
  });

  it('never matches a schedule trigger against a signal', () => {
    // Arrange
    const trigger: WorkflowTrigger = { type: 'schedule', cron: '0 9 * * *' };
    const signal: EngineSignal = { type: 'sale' };

    // Act & Assert
    expect(triggerMatches(trigger, signal)).toBe(false);
  });

  it('returns false for a malformed trigger', () => {
    // Arrange
    const signal: EngineSignal = { type: 'comment' };

    // Act & Assert
    expect(triggerMatches(null as unknown as WorkflowTrigger, signal)).toBe(false);
    expect(triggerMatches({ type: 'signal' } as unknown as WorkflowTrigger, signal)).toBe(false);
  });
});

describe('planSteps', () => {
  it('returns validated, ordered steps from a well-formed definition', () => {
    // Arrange
    const definition = {
      steps: [
        { key: 'a', action: 'draftReply', input: { tone: 'warm' } },
        { key: 'b', action: 'publish', requiresApproval: true },
      ],
    };

    // Act
    const steps = planSteps(definition);

    // Assert
    expect(steps).toHaveLength(2);
    expect(steps[0]?.key).toBe('a');
    expect(steps[0]?.action).toBe('draftReply');
    expect(steps[0]?.input).toEqual({ tone: 'warm' });
    expect(steps[1]?.requiresApproval).toBe(true);
  });

  it('preserves step order', () => {
    // Arrange
    const definition = { steps: [{ key: 's1', action: 'x' }, { key: 's2', action: 'y' }, { key: 's3', action: 'z' }] };

    // Act
    const steps = planSteps(definition);

    // Assert
    expect(steps.map((s) => s.key)).toEqual(['s1', 's2', 's3']);
  });

  it('drops steps missing a key or action defensively', () => {
    // Arrange
    const definition = {
      steps: [
        { key: '', action: 'x' },
        { key: 'ok', action: '' },
        { key: 'good', action: 'run' },
        'garbage',
        null,
      ],
    };

    // Act
    const steps = planSteps(definition);

    // Assert
    expect(steps).toHaveLength(1);
    expect(steps[0]?.key).toBe('good');
  });

  it('returns an empty array for a definition with no steps', () => {
    expect(planSteps({ steps: [] })).toEqual([]);
    expect(planSteps({})).toEqual([]);
    expect(planSteps(null)).toEqual([]);
    expect(planSteps({ steps: 'nope' })).toEqual([]);
  });

  it('omits input when it is not an object', () => {
    // Arrange
    const definition = { steps: [{ key: 'a', action: 'run', input: 'not-an-object' }] };

    // Act
    const steps = planSteps(definition);

    // Assert
    expect(steps[0]?.input).toBeUndefined();
  });

  it('only sets requiresApproval when strictly true', () => {
    // Arrange
    const definition = {
      steps: [
        { key: 'a', action: 'run', requiresApproval: false },
        { key: 'b', action: 'run', requiresApproval: 'yes' },
      ],
    };

    // Act
    const steps = planSteps(definition);

    // Assert
    expect(steps[0]?.requiresApproval).toBeUndefined();
    expect(steps[1]?.requiresApproval).toBeUndefined();
  });
});

describe('normalizeDefinition', () => {
  it('wraps planned steps in a definition object', () => {
    // Arrange & Act
    const def = normalizeDefinition({ steps: [{ key: 'a', action: 'run' }] });

    // Assert
    expect(def).toEqual({ steps: [{ key: 'a', action: 'run' }] });
  });

  it('yields empty steps for garbage input', () => {
    expect(normalizeDefinition(undefined)).toEqual({ steps: [] });
  });
});

describe('stepNeedsApproval', () => {
  it('is true only when requiresApproval is true', () => {
    expect(stepNeedsApproval({ key: 'a', action: 'x', requiresApproval: true })).toBe(true);
    expect(stepNeedsApproval({ key: 'a', action: 'x', requiresApproval: false })).toBe(false);
    expect(stepNeedsApproval({ key: 'a', action: 'x' })).toBe(false);
  });
});

describe('mergeRunContext', () => {
  it('merges output into the run context with later keys winning', () => {
    // Arrange
    const base = { a: 1, b: 2 };

    // Act
    const merged = mergeRunContext(base, { b: 3, c: 4 });

    // Assert
    expect(merged).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('does not mutate the inputs', () => {
    // Arrange
    const base = { a: 1 };
    const output = { b: 2 };

    // Act
    mergeRunContext(base, output);

    // Assert
    expect(base).toEqual({ a: 1 });
    expect(output).toEqual({ b: 2 });
  });
});
