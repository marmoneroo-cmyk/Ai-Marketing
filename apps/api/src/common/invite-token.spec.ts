import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInviteToken, readInviteToken } from './invite-token';

const SECRET = 'test-secret-at-least-16-chars-long';
const ORG_ID = 'org_123';
const INVITE_ID = 'invite_456';

describe('invite token', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips: decodes back to the orgId + inviteId it was issued for', () => {
    const token = createInviteToken(ORG_ID, INVITE_ID, SECRET);
    expect(readInviteToken(token, SECRET)).toEqual({ orgId: ORG_ID, inviteId: INVITE_ID });
  });

  it('rejects a tampered payload (signature mismatch)', () => {
    const token = createInviteToken(ORG_ID, INVITE_ID, SECRET);
    const [payload, sig] = token.split('.');
    // Flip a byte in the payload; the signature no longer matches.
    const tampered = `${payload}x.${sig ?? ''}`;
    expect(() => readInviteToken(tampered, SECRET)).toThrow(/signature|Malformed/i);
  });

  it('rejects a token signed with a different secret', () => {
    const token = createInviteToken(ORG_ID, INVITE_ID, 'a-completely-different-secret');
    expect(() => readInviteToken(token, SECRET)).toThrow(/signature/i);
  });

  it('rejects a missing token', () => {
    expect(() => readInviteToken('', SECRET)).toThrow(/Missing/i);
  });

  it('rejects a malformed token (no separator)', () => {
    expect(() => readInviteToken('not-a-real-token', SECRET)).toThrow(/Malformed/i);
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = createInviteToken(ORG_ID, INVITE_ID, SECRET);
    // Advance past the 7-day TTL.
    vi.setSystemTime(new Date('2026-01-09T00:00:00Z'));
    expect(() => readInviteToken(token, SECRET)).toThrow(/expired/i);
  });
});
