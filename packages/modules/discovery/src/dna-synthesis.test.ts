import { describe, it, expect } from 'vitest';
import { parseDna, computeCompleteness } from './dna-synthesis';

describe('parseDna', () => {
  it('returns empty DNA for non-JSON output', () => {
    const dna = parseDna('the model rambled without JSON');
    expect(dna.description).toBe('');
    expect(dna.personas).toEqual([]);
  });

  it('extracts a JSON envelope embedded in prose', () => {
    const dna = parseDna('Here you go: {"description":"A bakery","categories":["food"],"personas":[{"name":"Foodie"}]} done');
    expect(dna.description).toBe('A bakery');
    expect(dna.categories).toEqual(['food']);
    expect(dna.personas[0]?.name).toBe('Foodie');
  });

  it('drops non-string array entries defensively', () => {
    const dna = parseDna('{"categories":["ok", 5, null, "fine"]}');
    expect(dna.categories).toEqual(['ok', 'fine']);
  });
});

describe('computeCompleteness', () => {
  it('is 0 for an empty DNA and 1 when all key fields are present', () => {
    expect(computeCompleteness(parseDna(''))).toBe(0);
    const full = parseDna(
      '{"description":"d","mission":"m","usp":"u","categories":["c"],"personas":[{"name":"p"}]}',
    );
    expect(computeCompleteness(full)).toBe(1);
  });
});
