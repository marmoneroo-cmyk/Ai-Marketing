import { asString, extractJsonSlice } from '@brandpilot/agent-runtime';

/** Build the intent-classification prompt. Instructs the model to return STRINGIFIED JSON. */
export function buildIntentPrompt(text: string): string {
  return [
    'Classify the intent of the following inbound customer message for a small business.',
    'Put a STRINGIFIED JSON object in your "output" with this exact shape:',
    '{ "intent": string }',
    'Use a short snake_case label such as: question, pricing, booking, complaint, support, compliment, spam, other.',
    '--- MESSAGE ---',
    text,
  ].join('\n\n');
}

/**
 * Parse the intent-classification model output defensively; never throws.
 * Accepts either the JSON envelope `{ "intent": "..." }` or a bare string label,
 * and normalizes to a trimmed, lowercased token (empty string when absent).
 */
export function parseIntent(output: string): string {
  const normalize = (value: string): string => value.trim().toLowerCase();

  try {
    const obj = JSON.parse(extractJsonSlice(output)) as { intent?: unknown };
    const intent = asString(obj.intent);
    if (intent.length > 0) return normalize(intent);
  } catch {
    // fall through to the bare-string fallback below
  }

  return normalize(output);
}
