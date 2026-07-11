import { asRecord, asString, asStringArray, parseModelJson } from '@brandpilot/agent-runtime';

const MAX_CORPUS_CHARS = 12000;

/** A persona inferred from audience material. */
export interface ParsedPersona {
  name: string;
  demographics: Record<string, unknown>;
  goals: string[];
  painPoints: string[];
  buyingTriggers: string[];
  objections: string[];
  channels: string[];
}

/** An audience segment inferred from audience material. */
export interface ParsedSegment {
  name: string;
  criteria: Record<string, unknown>;
  interests: string[];
  /** Sentiment in [-1,1]; null when unknown. */
  sentiment: number | null;
  /** Rough audience size; null when unknown. */
  sizeEstimate: number | null;
}

/** A recurring objection and its rebuttal. */
export interface ParsedObjection {
  objection: string;
  rebuttal: string;
}

export interface AudienceIntel {
  personas: ParsedPersona[];
  segments: ParsedSegment[];
  objections: ParsedObjection[];
}

/** Build a bounded corpus from mixed audience material (comments + docs). */
export function buildAudienceCorpus(contents: readonly string[]): string {
  return contents
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .join('\n\n')
    .trim()
    .slice(0, MAX_CORPUS_CHARS);
}

/** Build the reasoning prompt that turns audience material into structured intel. */
export function buildAudiencePrompt(corpus: string): string {
  return [
    'Analyze the following audience material for a small business (customer comments, reviews, and knowledge docs).',
    'Infer the audience. Put a STRINGIFIED JSON object in your "output" with this shape:',
    '{ "personas": [{ "name": string, "demographics": object, "goals": string[], "painPoints": string[], "buyingTriggers": string[], "objections": string[], "channels": string[] }],',
    '  "segments": [{ "name": string, "criteria": object, "interests": string[], "sentiment": number, "sizeEstimate": number }],',
    '  "objections": [{ "objection": string, "rebuttal": string }] }',
    'sentiment is in [-1,1]. If something is unknown, use an empty array/object or null. Do NOT invent claims or numbers you cannot support.',
    '--- MATERIAL ---',
    corpus,
  ].join('\n\n');
}

const asNumberOrNull = (v: unknown): number | null =>
  typeof v === 'number' && !Number.isNaN(v) ? v : null;

function toPersona(v: unknown): ParsedPersona {
  const o = asRecord(v);
  return {
    name: asString(o.name),
    demographics: asRecord(o.demographics),
    goals: asStringArray(o.goals),
    painPoints: asStringArray(o.painPoints),
    buyingTriggers: asStringArray(o.buyingTriggers),
    objections: asStringArray(o.objections),
    channels: asStringArray(o.channels),
  };
}

function toSegment(v: unknown): ParsedSegment {
  const o = asRecord(v);
  return {
    name: asString(o.name),
    criteria: asRecord(o.criteria),
    interests: asStringArray(o.interests),
    sentiment: asNumberOrNull(o.sentiment),
    sizeEstimate: asNumberOrNull(o.sizeEstimate),
  };
}

function toObjection(v: unknown): ParsedObjection {
  const o = asRecord(v);
  return { objection: asString(o.objection), rebuttal: asString(o.rebuttal) };
}

/** Parse the model's audience output defensively; never throws. */
export function parseAudienceIntel(output: string): AudienceIntel {
  const obj = parseModelJson<Record<string, unknown>>(output, {});
  return {
    personas: Array.isArray(obj.personas) ? obj.personas.map(toPersona) : [],
    segments: Array.isArray(obj.segments) ? obj.segments.map(toSegment) : [],
    objections: Array.isArray(obj.objections) ? obj.objections.map(toObjection) : [],
  };
}
