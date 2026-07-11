import { CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS } from '@brandpilot/config';

/** Rough chars-per-token heuristic for sizing chunks without a tokenizer dep. */
const CHARS_PER_TOKEN = 4;

/**
 * Split text into overlapping chunks of ~CHUNK_SIZE_TOKENS tokens. Overlap keeps
 * context continuous across chunk boundaries so retrieval doesn't lose meaning.
 */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const size = CHUNK_SIZE_TOKENS * CHARS_PER_TOKEN;
  const overlap = CHUNK_OVERLAP_TOKENS * CHARS_PER_TOKEN;
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + size, clean.length);
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks;
}
