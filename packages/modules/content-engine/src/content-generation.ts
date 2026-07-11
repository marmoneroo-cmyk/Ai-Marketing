import { CONTENT_FORMATS } from '@brandpilot/core';
import { asString, asStringArray, clamp, parseModelJson } from '@brandpilot/agent-runtime';
import type { ContentFormat, PlanContext, PlannedItem, VariantCopy, WeeklyPlan } from './types';

const MAX_LIST_ITEMS = 20;

const VALID_FORMATS = new Set<string>(CONTENT_FORMATS);

/** Compact a business-facts list for prompt injection (bounded, deduped-empty). */
function summarizeList(items: readonly string[]): string {
  const cleaned = items.map((s) => s.trim()).filter((s) => s.length > 0).slice(0, MAX_LIST_ITEMS);
  return cleaned.length > 0 ? cleaned.join(', ') : '(none provided)';
}

/**
 * Render a bounded, one-per-line bulleted list. Unlike {@link summarizeList},
 * entries are not comma-joined, so items whose text contains commas (e.g. a
 * competitor's positioning sentence) stay intact.
 */
function bulletList(items: readonly string[]): string {
  return items
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_LIST_ITEMS)
    .map((s) => `- ${s}`)
    .join('\n');
}

/** Build the weekly-plan prompt. Instructs the model to return STRINGIFIED JSON. */
export function buildWeeklyPlanPrompt(ctx: PlanContext): string {
  const insights = ctx.insights ?? [];
  const competitors = ctx.competitors ?? [];
  const personas = ctx.personas ?? [];
  return [
    'Plan one week of social content for a small business.',
    'Use the business facts below to choose content pillars and concrete item ideas.',
    `KNOWN SERVICES: ${summarizeList(ctx.services)}`,
    `KNOWN PRODUCTS: ${summarizeList(ctx.products)}`,
    `AUDIENCE SEGMENTS: ${summarizeList(ctx.segments)}`,
    // Personas carry the audience's pains + goals — the richest signal for
    // choosing angles. Bulleted (not comma-joined) so multi-item pains stay intact.
    personas.length > 0
      ? `AUDIENCE PERSONAS (speak to their pains and goals):\n${bulletList(personas)}`
      : '',
    // Competitor positioning is INTERNAL strategy input: use it to differentiate
    // and fill gaps rivals leave — never to name or disparage them in captions.
    // Bulleted directly (not comma-joined) so positioning text with commas is safe.
    competitors.length > 0
      ? `COMPETITORS (position AGAINST these — differentiate and fill the gaps they leave; do NOT name or attack them in the content itself):\n${bulletList(competitors)}`
      : '',
    // NOTE: brand voice is deliberately NOT rendered here. The shared
    // AgentRuntime already injects it into every call's system prompt from the
    // same brain.getVoiceProfile source (see agent-runtime.ts) — rendering it
    // again in this prompt would just duplicate tokens with zero grounding gain.
    // Close the feedback loop: fold recent optimization / brand recommendations
    // back into planning so the system learns from its own performance data.
    insights.length > 0
      ? `RECENT PERFORMANCE RECOMMENDATIONS (apply where relevant):\n${summarizeList(insights).split(', ').map((s) => `- ${s}`).join('\n')}`
      : '',
    'Put a STRINGIFIED JSON object in your "output" with this exact shape:',
    '{ "pillars": string[], "items": [{ "format": string, "pillar": string, "brief": string }] }',
    `"format" MUST be one of: ${CONTENT_FORMATS.join(', ')}.`,
    // Owner-preferred formats (from the "preferred formats" picker) narrow the
    // general format enum above into a hard preference for THIS run only.
    ctx.formats && ctx.formats.length > 0
      ? `Only plan content in these formats: ${ctx.formats.join(', ')} — every item's format MUST be one of these.`
      : '',
    'Each "brief" is a one-line hook / angle / CTA idea. Aim for 5-7 items across the pillars.',
    'Do NOT invent specific prices, guarantees, or claims.',
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');
}

/**
 * Defensive: the model may ignore the format-preference instruction injected by
 * {@link buildWeeklyPlanPrompt}, so when the owner picked formats, deterministically
 * coerce any off-list item to the first preferred format instead of trusting the
 * model's compliance. A no-op (returns a shallow copy) when `formats` is
 * absent/empty, preserving today's exact behavior.
 */
export function applyFormatPreference(
  items: readonly PlannedItem[],
  formats?: ContentFormat[],
): PlannedItem[] {
  const firstFormat = formats?.[0];
  if (!formats || !firstFormat) return [...items];
  return items.map((item) => (formats.includes(item.format) ? item : { ...item, format: firstFormat }));
}

/** Build the per-platform caption prompt for one planned item. */
export function buildVariantPrompt(input: {
  platform: string;
  format: string;
  pillar: string;
  brief: string;
}): string {
  return [
    `Write ${input.platform} copy for a single ${input.format} content item.`,
    input.pillar ? `Content pillar: ${input.pillar}` : '',
    input.brief ? `Brief / angle: ${input.brief}` : '',
    'Ground every factual claim in the provided CONTEXT. Do NOT invent prices, offers, or guarantees.',
    'Put a STRINGIFIED JSON object in your "output" with this exact shape:',
    '{ "caption": string, "hook": string, "cta": string, "hashtags": string[] }',
    `Tailor length, tone, and hashtag usage to ${input.platform} conventions.`,
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');
}

/** Parse the weekly-plan model output defensively; never throws. */
export function parseWeeklyPlan(output: string): WeeklyPlan {
  const obj = parseModelJson<Partial<WeeklyPlan>>(output, {});
  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const items = rawItems
    .map((it) => {
      const record = (it ?? {}) as unknown as Record<string, unknown>;
      const format = asString(record.format);
      return {
        format: (VALID_FORMATS.has(format) ? format : 'post') as WeeklyPlan['items'][number]['format'],
        pillar: asString(record.pillar),
        brief: asString(record.brief),
      };
    })
    .filter((it) => it.brief.length > 0 || it.pillar.length > 0);
  return { pillars: asStringArray(obj.pillars), items };
}

/** Parse the per-platform copy model output defensively; never throws. */
export function parseVariantCopy(output: string): VariantCopy {
  const obj = parseModelJson<Partial<VariantCopy>>(output, {});
  return {
    caption: asString(obj.caption),
    hook: asString(obj.hook),
    cta: asString(obj.cta),
    hashtags: asStringArray(obj.hashtags),
  };
}

/**
 * Build the voice-conformance scoring prompt. Given a brand's do/don't examples
 * and a candidate draft, the model returns a single [0,1] score of how well the
 * draft matches the brand voice — a real conformance measure, not a proxy for
 * generation confidence.
 */
export function buildVoiceScorePrompt(input: {
  draft: string;
  voiceDo: readonly string[];
  voiceDont: readonly string[];
}): string {
  return [
    'Score how well the DRAFT below matches the brand voice.',
    `BRAND VOICE — do (on-brand): ${summarizeList(input.voiceDo)}`,
    `BRAND VOICE — avoid (off-brand): ${summarizeList(input.voiceDont)}`,
    'Judge tone, phrasing, and vocabulary against those examples only.',
    'Put a STRINGIFIED JSON object in your "output" with this exact shape:',
    '{ "voiceScore": number }  // 1 = perfectly on-brand, 0 = off-brand',
    '--- DRAFT ---',
    input.draft,
  ].join('\n\n');
}

/** Parse the voice-conformance score; defaults to 0 when absent/malformed. */
export function parseVoiceScore(output: string): number {
  const obj = parseModelJson<{ voiceScore?: unknown }>(output, {});
  return clampScore(typeof obj.voiceScore === 'number' ? obj.voiceScore : Number(obj.voiceScore));
}

/** Clamp a raw confidence into the [0,1] voice-score range. */
export function clampScore(value: number): number {
  return clamp(value, 0, 1, 0);
}
