import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateOneTimeToken, hashOneTimeToken } from './one-time-token';

describe('generateOneTimeToken', () => {
  it('returns distinct raw values across calls', () => {
    const a = generateOneTimeToken();
    const b = generateOneTimeToken();

    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });

  it('returns a hash equal to the sha256 hex digest of raw', () => {
    const { raw, hash } = generateOneTimeToken();

    const expected = createHash('sha256').update(raw).digest('hex');
    expect(hash).toBe(expected);
  });

  it('produces a raw value that is URL-safe base64url (no +, /, or =)', () => {
    const { raw } = generateOneTimeToken();

    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(raw).not.toMatch(/[+/=]/);
  });
});

describe('hashOneTimeToken', () => {
  it('matches the hash produced by generateOneTimeToken for the same raw value', () => {
    const { raw, hash } = generateOneTimeToken();

    expect(hashOneTimeToken(raw)).toBe(hash);
  });

  it('is deterministic: hashing the same raw value twice yields the same hash', () => {
    const { raw } = generateOneTimeToken();

    expect(hashOneTimeToken(raw)).toBe(hashOneTimeToken(raw));
  });
});
