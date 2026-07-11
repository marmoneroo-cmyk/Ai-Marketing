import { asString, asStringArray, clamp, parseModelJson } from '@brandpilot/agent-runtime';
import type { Briefing, BriefingContext } from './types';

const MAX_MESSAGES = 20;

/** Coerce an unknown into a finite number (0 otherwise). */
function asNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Compact the recent-message history for prompt injection (bounded, trimmed). */
function summarizeMessages(messages: readonly string[]): string {
  const cleaned = messages.map((m) => m.trim()).filter((m) => m.length > 0).slice(-MAX_MESSAGES);
  return cleaned.length > 0 ? cleaned.map((m) => `- ${m}`).join('\n') : '(no recent messages)';
}

/** Build the pre-meeting briefing prompt. Instructs the model to return STRINGIFIED JSON. */
export function buildBriefingPrompt(ctx: BriefingContext): string {
  return [
    'Prepare a concise pre-meeting briefing for a small-business owner about to speak with a contact.',
    ctx.name ? `CONTACT: ${ctx.name}` : 'CONTACT: (unnamed)',
    `RECENT MESSAGES:\n${summarizeMessages(ctx.recentMessages)}`,
    ctx.grounding ? `KNOWN CONTEXT:\n${ctx.grounding}` : 'KNOWN CONTEXT: (none provided)',
    'Ground every claim in the provided context. Do NOT invent facts about the contact.',
    'Put a STRINGIFIED JSON object in your "output" with this exact shape:',
    '{ "summary": string, "businessSummary": string, "interests": string[], "talkingPoints": string[], "intentEstimate": number }',
    '"intentEstimate" is buying intent in the [0,1] range. Keep talking points specific and actionable.',
  ].join('\n\n');
}

/** Parse the briefing model output defensively; never throws. */
export function parseBriefing(output: string): Briefing {
  const obj = parseModelJson<Partial<Briefing>>(output, {});
  return {
    summary: asString(obj.summary),
    businessSummary: asString(obj.businessSummary),
    interests: asStringArray(obj.interests),
    talkingPoints: asStringArray(obj.talkingPoints),
    intentEstimate: clampScore(asNumber(obj.intentEstimate)),
  };
}

/** Clamp a raw score into the [0,1] range. */
export function clampScore(value: number): number {
  return clamp(value, 0, 1, 0);
}
