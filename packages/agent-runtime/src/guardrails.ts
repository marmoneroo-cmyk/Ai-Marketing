import { ALWAYS_ESCALATE_INTENTS } from '@brandpilot/config';

export interface GuardrailInput {
  text: string;
  /** Per-org banned topics (from org settings). */
  bannedTopics?: string[];
}

export interface GuardrailResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Hard safety net for customer-facing output: escalate on sensitive intents,
 * block banned topics. Runs in addition to grounding checks.
 */
export function checkGuardrails(input: GuardrailInput): GuardrailResult {
  const lower = input.text.toLowerCase();

  for (const intent of ALWAYS_ESCALATE_INTENTS) {
    if (lower.includes(intent)) return { allowed: false, reason: `escalate:${intent}` };
  }
  for (const topic of input.bannedTopics ?? []) {
    if (topic && lower.includes(topic.toLowerCase())) return { allowed: false, reason: `banned:${topic}` };
  }
  return { allowed: true };
}
