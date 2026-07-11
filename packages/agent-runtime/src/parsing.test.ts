import { describe, it, expect } from 'vitest';
import {
  extractJsonSlice,
  parseModelJson,
  asString,
  asStringArray,
  asRecord,
  clamp,
} from './parsing';

describe('extractJsonSlice', () => {
  it('isolates an object embedded in surrounding prose', () => {
    const text = 'Sure! Here is the answer:\n{"a":1,"b":"two"}\nHope that helps.';
    expect(extractJsonSlice(text)).toBe('{"a":1,"b":"two"}');
  });

  it('returns the original text unchanged when no object braces are present', () => {
    const text = 'no json here';
    expect(extractJsonSlice(text)).toBe(text);
  });

  it('uses the last closing brace so nested objects are preserved', () => {
    const text = 'prefix {"a":{"b":1}} suffix';
    expect(extractJsonSlice(text)).toBe('{"a":{"b":1}}');
  });

  it('ignores a leading array and grabs the object by default', () => {
    const text = '[1,2,3] then {"a":1}';
    expect(extractJsonSlice(text)).toBe('{"a":1}');
  });

  describe('with preferArray', () => {
    it('prefers a top-level array that opens before the first object', () => {
      const text = 'here: [{"a":1},{"a":2}] done';
      expect(extractJsonSlice(text, { preferArray: true })).toBe('[{"a":1},{"a":2}]');
    });

    it('falls back to an object when it opens before any array', () => {
      const text = 'obj {"a":[1,2]} tail';
      expect(extractJsonSlice(text, { preferArray: true })).toBe('{"a":[1,2]}');
    });

    it('returns the original text when neither bracket type is found', () => {
      const text = 'plain text';
      expect(extractJsonSlice(text, { preferArray: true })).toBe(text);
    });
  });
});

describe('parseModelJson', () => {
  it('parses prose-wrapped JSON into a typed object', () => {
    const result = parseModelJson<{ a: number }>('noise {"a":1} noise', { a: 0 });
    expect(result).toEqual({ a: 1 });
  });

  it('parses a bare array when preferArray is set', () => {
    const result = parseModelJson<number[]>('vals: [1,2,3]', [], { preferArray: true });
    expect(result).toEqual([1, 2, 3]);
  });

  it('returns the fallback on malformed input instead of throwing', () => {
    const fallback = { ok: false };
    expect(parseModelJson('not json {oops', fallback)).toBe(fallback);
  });

  it('returns the fallback for the empty string', () => {
    const fallback: unknown[] = [];
    expect(parseModelJson('', fallback)).toBe(fallback);
  });
});

describe('asString', () => {
  it('returns the string unchanged', () => {
    expect(asString('hi')).toBe('hi');
  });

  it('coerces non-strings to an empty string', () => {
    expect(asString(42)).toBe('');
    expect(asString(null)).toBe('');
    expect(asString(undefined)).toBe('');
    expect(asString({ a: 1 })).toBe('');
    expect(asString(['a'])).toBe('');
  });
});

describe('asStringArray', () => {
  it('keeps only string members', () => {
    expect(asStringArray(['a', 1, 'b', null, 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for non-array input', () => {
    expect(asStringArray('a')).toEqual([]);
    expect(asStringArray(null)).toEqual([]);
    expect(asStringArray({ 0: 'a' })).toEqual([]);
  });
});

describe('asRecord', () => {
  it('returns plain objects unchanged', () => {
    const obj = { a: 1 };
    expect(asRecord(obj)).toBe(obj);
  });

  it('returns an empty record for arrays, null, and primitives', () => {
    expect(asRecord(['a'])).toEqual({});
    expect(asRecord(null)).toEqual({});
    expect(asRecord(42)).toEqual({});
    expect(asRecord('s')).toEqual({});
  });
});

describe('clamp', () => {
  it('returns the value when inside the range', () => {
    expect(clamp(0.5, 0, 1, 0.5)).toBe(0.5);
  });

  it('clamps to the lower and upper bounds', () => {
    expect(clamp(-5, 0, 1, 0.5)).toBe(0);
    expect(clamp(5, 0, 1, 0.5)).toBe(1);
  });

  it('uses the fallback for non-numeric input', () => {
    expect(clamp('nope', 0, 1, 0.3)).toBe(0.3);
    expect(clamp(undefined, 0, 1, 0.3)).toBe(0.3);
    expect(clamp(null, 0, 1, 0.3)).toBe(0.3);
  });

  it('uses the fallback for non-finite numbers', () => {
    expect(clamp(NaN, 0, 1, 0.4)).toBe(0.4);
    expect(clamp(Infinity, 0, 1, 0.4)).toBe(0.4);
    expect(clamp(-Infinity, 0, 1, 0.4)).toBe(0.4);
  });

  it('clamps the fallback itself into range when it is out of bounds', () => {
    expect(clamp('bad', 0, 1, 5)).toBe(1);
    expect(clamp('bad', 0, 1, -5)).toBe(0);
  });
});
