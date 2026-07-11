import { describe, it, expect } from 'vitest';
import { chunkText } from './chunking';

describe('chunkText', () => {
  it('returns an empty array for blank input', () => {
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('returns a single chunk for short text', () => {
    expect(chunkText('hello world')).toEqual(['hello world']);
  });

  it('splits long text into multiple overlapping chunks', () => {
    const long = 'word '.repeat(2000); // ~10k chars, well over one chunk
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length > 0)).toBe(true);
  });
});
