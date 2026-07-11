import { asRecord, asStringArray, clamp, parseModelJson } from '@brandpilot/agent-runtime';
import type { VoiceProfile } from '@brandpilot/business-brain';

const MAX_CORPUS_CHARS = 12000;

/** Join a set of documents into a single bounded corpus for the model. */
export function buildCorpus(contents: readonly string[]): string {
  return contents
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .join('\n\n')
    .trim()
    .slice(0, MAX_CORPUS_CHARS);
}

/** Build the reasoning prompt that infers a brand VoiceProfile from real copy. */
export function buildVoicePrompt(corpus: string): string {
  return [
    'Analyze the following authentic material written by or for a small business (website copy, captions, posts).',
    'Infer the brand voice. Put a STRINGIFIED JSON object in your "output" with this shape:',
    '{ "personality": object, "tone": object, "vocabulary": { "preferred": string[], "avoid": string[] },',
    '  "doExamples": string[], "dontExamples": string[], "confidence": number }',
    'personality/tone are free-form objects of trait->description. confidence is a number in [0,1].',
    'doExamples are short phrases that sound on-brand; dontExamples sound off-brand.',
    'If something is unknown, use an empty object or empty array. Do NOT invent claims, prices, or guarantees.',
    '--- MATERIAL ---',
    corpus,
  ].join('\n\n');
}

/** Clamp a raw confidence into [0,1] at 3-decimal precision (non-numbers → 0). */
const clampConfidence = (v: unknown): number => Number(clamp(v, 0, 1, 0).toFixed(3));

/** Parse the model's voice output defensively; never throws. */
export function parseVoiceProfile(output: string): VoiceProfile {
  const empty: VoiceProfile = {
    personality: {},
    tone: {},
    vocabulary: {},
    doExamples: [],
    dontExamples: [],
    confidence: 0,
  };

  const obj = parseModelJson<Record<string, unknown>>(output, {});
  if (Object.keys(obj).length === 0) return empty;
  return {
    personality: asRecord(obj.personality),
    tone: asRecord(obj.tone),
    vocabulary: asRecord(obj.vocabulary),
    doExamples: asStringArray(obj.doExamples),
    dontExamples: asStringArray(obj.dontExamples),
    confidence: clampConfidence(obj.confidence),
  };
}
