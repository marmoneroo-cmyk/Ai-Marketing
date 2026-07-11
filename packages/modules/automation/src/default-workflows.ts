import type { WorkflowSpec } from './types';

/**
 * Out-of-the-box automation workflows seeded for every new org so the
 * autonomous loop runs with zero manual setup. Every `action` here MUST map to
 * a name registered in the worker's action registry, and every signal `match`
 * MUST be a real `SignalType` — the engine is decoupled and resolves both by
 * name at run time.
 */
export const DEFAULT_WORKFLOW_SPECS: WorkflowSpec[] = [
  {
    name: 'Weekly content plan',
    trigger: { type: 'schedule', cron: '0 8 * * 1' },
    definition: {
      steps: [{ key: 'plan', action: 'content.weekly_plan' }],
    },
  },
  {
    name: 'Qualify new leads',
    trigger: { type: 'signal', match: { type: 'lead_created' } },
    definition: {
      steps: [
        { key: 'qualify', action: 'sales.qualify' },
        { key: 'brief', action: 'prep.briefing' },
      ],
    },
  },
  {
    name: 'Pre-meeting briefing',
    trigger: { type: 'signal', match: { type: 'appointment_booked' } },
    definition: {
      steps: [{ key: 'brief', action: 'prep.briefing' }],
    },
  },
];
