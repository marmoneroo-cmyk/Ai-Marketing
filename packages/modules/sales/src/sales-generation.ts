import { asString, asStringArray, clamp, parseModelJson } from '@brandpilot/agent-runtime';
import type {
  LeadQualification,
  ProposalContext,
  ProposalDraft,
  ProposalLineItem,
} from './types';

const MAX_LIST_ITEMS = 20;
const MONEY_SCALE = 2;

/** Coerce an unknown into a finite, non-negative number (0 otherwise). */
function asNonNegativeNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Compact a business-facts list for prompt injection (bounded, trimmed). */
function summarizeList(items: readonly string[]): string {
  const cleaned = items.map((s) => s.trim()).filter((s) => s.length > 0).slice(0, MAX_LIST_ITEMS);
  return cleaned.length > 0 ? cleaned.join(', ') : '(none provided)';
}

/** Build the lead-qualification prompt. Instructs the model to return STRINGIFIED JSON. */
export function buildQualifyPrompt(input: {
  name: string;
  email: string;
  source: string;
  status: string;
  notes: string;
  /** Ideal-customer persona names/briefs, so fit is judged against who the business actually serves. */
  personas?: string[];
  /** Known services/products, so fit is judged against what the business actually sells. */
  services?: string[];
  products?: string[];
}): string {
  return [
    'Qualify this inbound lead for a small business sales pipeline.',
    'Weigh fit, buying intent, and how much context we have. Be conservative when context is thin.',
    input.name ? `LEAD NAME: ${input.name}` : '',
    input.email ? `LEAD EMAIL: ${input.email}` : '',
    input.source ? `LEAD SOURCE: ${input.source}` : '',
    input.status ? `CURRENT STATUS: ${input.status}` : '',
    input.notes ? `CONTEXT: ${input.notes}` : '',
    input.personas && input.personas.length > 0
      ? `IDEAL CUSTOMER PERSONAS: ${summarizeList(input.personas)}`
      : '',
    input.services && input.services.length > 0 ? `SERVICES OFFERED: ${summarizeList(input.services)}` : '',
    input.products && input.products.length > 0 ? `PRODUCTS OFFERED: ${summarizeList(input.products)}` : '',
    'Weigh how well this lead matches the ideal customer personas and offerings above — a lead with no',
    'apparent fit for what the business sells or who it serves should score low even with strong buying intent.',
    'Put a STRINGIFIED JSON object in your "output" with this exact shape:',
    '{ "score": number, "reasoning": string }',
    '"score" is qualification likelihood in the [0,1] range. Do NOT invent facts about the lead.',
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');
}

/** Build the proposal + quote prompt from the business offering catalogue. */
export function buildProposalPrompt(ctx: ProposalContext): string {
  return [
    'Draft a sales proposal and an itemized quote for a qualified lead.',
    'Only use the known services, products, and offers below. Do NOT invent new offerings.',
    `KNOWN SERVICES: ${summarizeList(ctx.services)}`,
    `KNOWN PRODUCTS: ${summarizeList(ctx.products)}`,
    `ACTIVE OFFERS: ${summarizeList(ctx.offers)}`,
    'Put a STRINGIFIED JSON object in your "output" with this exact shape:',
    '{ "sections": string[], "lineItems": [{ "name": string, "qty": number, "unitPrice": number }] }',
    'Each "section" is a short proposal paragraph. Prices must be realistic for the listed offerings.',
  ].join('\n\n');
}

/** Parse the lead-qualification model output defensively; never throws. */
export function parseQualification(output: string): LeadQualification {
  const obj = parseModelJson<Partial<LeadQualification>>(output, {});
  return {
    score: clampScore(asNonNegativeNumber(obj.score)),
    reasoning: asString(obj.reasoning),
  };
}

/** Parse the proposal + quote model output defensively; never throws. */
export function parseProposalDraft(output: string): ProposalDraft {
  const obj = parseModelJson<Partial<ProposalDraft>>(output, {});
  const rawItems = Array.isArray(obj.lineItems) ? obj.lineItems : [];
  const lineItems = rawItems
    .map((it): ProposalLineItem => {
      const record = (it ?? {}) as unknown as Record<string, unknown>;
      return {
        name: asString(record.name),
        qty: asNonNegativeNumber(record.qty),
        unitPrice: asNonNegativeNumber(record.unitPrice),
      };
    })
    .filter((it) => it.name.length > 0);
  return { sections: asStringArray(obj.sections), lineItems };
}

/** Sum line items into a subtotal/total (kept identical here; tax is a later increment). */
export function computeTotals(lineItems: readonly ProposalLineItem[]): {
  subtotal: number;
  total: number;
} {
  const subtotal = lineItems.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
  return { subtotal, total: subtotal };
}

/** Format a numeric amount as a fixed-scale string for drizzle `numeric` columns. */
export function toMoneyString(amount: number): string {
  return asNonNegativeNumber(amount).toFixed(MONEY_SCALE);
}

/** Clamp a raw score into the [0,1] range. */
export function clampScore(value: number): number {
  return clamp(value, 0, 1, 0);
}
