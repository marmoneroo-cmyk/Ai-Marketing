import { asString, asStringArray, parseModelJson } from '@brandpilot/agent-runtime';
import type { SynthesizedDna } from './types';

const MAX_CORPUS_CHARS = 12000;

/** Build the Opus prompt that turns raw scraped material into a structured DNA. */
export function buildDnaPrompt(corpus: string): string {
  return [
    'Analyze the following material collected from a small business (website copy, social captions, reviews).',
    'Infer a structured Business DNA. Put a STRINGIFIED JSON object in your "output" with this shape:',
    '{ "description": string, "mission": string, "vision": string, "usp": string, "categories": string[],',
    '  "personas": [{ "name": string, "demographics": object, "goals": string[], "painPoints": string[], "buyingTriggers": string[], "objections": string[], "channels": string[] }],',
    '  "competitors": [{ "name": string, "positioning": string, "strengths": string[], "weaknesses": string[] }] }',
    'If something is unknown, use an empty string or empty array. Do NOT invent specific prices, guarantees, or claims.',
    '--- MATERIAL ---',
    corpus.slice(0, MAX_CORPUS_CHARS),
  ].join('\n\n');
}

/** Parse the model's DNA output defensively; never throws. */
export function parseDna(output: string): SynthesizedDna {
  const empty: SynthesizedDna = {
    description: '',
    mission: '',
    vision: '',
    usp: '',
    categories: [],
    personas: [],
    competitors: [],
  };

  const obj = parseModelJson<Partial<SynthesizedDna>>(output, empty);
  return {
    description: asString(obj.description),
    mission: asString(obj.mission),
    vision: asString(obj.vision),
    usp: asString(obj.usp),
    categories: asStringArray(obj.categories),
    personas: Array.isArray(obj.personas) ? (obj.personas as SynthesizedDna['personas']) : [],
    competitors: Array.isArray(obj.competitors) ? (obj.competitors as SynthesizedDna['competitors']) : [],
  };
}

/** Fraction of key DNA fields that came back populated (drives profile completeness). */
export function computeCompleteness(dna: SynthesizedDna): number {
  const checks = [
    dna.description.length > 0,
    dna.mission.length > 0,
    dna.usp.length > 0,
    dna.categories.length > 0,
    dna.personas.length > 0,
  ];
  const filled = checks.filter(Boolean).length;
  return Number((filled / checks.length).toFixed(3));
}
