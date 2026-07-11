import { z } from 'zod';

/**
 * Signals are the append-only episodic memory of the Business Brain and the
 * triggers for the Automation Engine. Every module emits signals; none imports
 * another module's internals — this is the decoupling spine.
 */
export const SIGNAL_TYPES = [
  'post_published',
  'comment',
  'dm',
  'like',
  'share',
  'save',
  'lead_created',
  'lead_qualified',
  'appointment_booked',
  'sale',
  'review',
  'metric_snapshot',
  'conversation_started',
  'message_sent',
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const signalSchema = z.object({
  type: z.enum(SIGNAL_TYPES),
  subjectType: z.string().optional(),
  subjectId: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  value: z.number().optional(),
  occurredAt: z.date().optional(),
});
// Use the INPUT type so defaulted/optional fields (payload, occurredAt) are
// optional for callers; BusinessBrain.recordSignal fills defaults.
export type SignalInput = z.input<typeof signalSchema>;
