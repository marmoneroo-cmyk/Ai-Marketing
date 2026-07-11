import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOAuthState,
  readOAuthState,
  readOAuthStateWithProvider,
  verifyOAuthState,
  createNonceState,
  verifyNonceState,
} from './oauth-state';

const SECRET = 'test-secret-at-least-16-chars-long';
const ORG = 'org_123';

describe('OAuth state', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('readOAuthState', () => {
    it('round-trips: returns the org the state was issued for', () => {
      const state = createOAuthState(ORG, SECRET);
      expect(readOAuthState(state, SECRET)).toBe(ORG);
    });

    it('rejects a tampered payload (signature mismatch)', () => {
      const state = createOAuthState(ORG, SECRET);
      const [payload, sig] = state.split('.');
      // Flip a byte in the payload; the signature no longer matches.
      const tampered = `${payload}x.${sig ?? ''}`;
      expect(() => readOAuthState(tampered, SECRET)).toThrow(/signature|Malformed/i);
    });

    it('rejects a state signed with a different secret', () => {
      const state = createOAuthState(ORG, 'a-completely-different-secret');
      expect(() => readOAuthState(state, SECRET)).toThrow(/signature/i);
    });

    it('rejects a missing state', () => {
      expect(() => readOAuthState(undefined, SECRET)).toThrow(/Missing/i);
    });

    it('rejects an expired state', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const state = createOAuthState(ORG, SECRET);
      // Advance past the 10-minute TTL.
      vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
      expect(() => readOAuthState(state, SECRET)).toThrow(/expired/i);
    });
  });

  describe('readOAuthStateWithProvider', () => {
    it('round-trips both the org and the provider bound in at issue', () => {
      const state = createOAuthState(ORG, SECRET, 'facebook');
      expect(readOAuthStateWithProvider(state, SECRET)).toEqual({ orgId: ORG, provider: 'facebook' });
    });

    it('omits `provider` when the state was issued without one (e.g. TikTok)', () => {
      const state = createOAuthState(ORG, SECRET);
      expect(readOAuthStateWithProvider(state, SECRET)).toEqual({ orgId: ORG });
    });

    it('still enforces the same HMAC/expiry checks as readOAuthState', () => {
      const state = createOAuthState(ORG, SECRET, 'instagram');
      const [payload, sig] = state.split('.');
      const tampered = `${payload}x.${sig ?? ''}`;
      expect(() => readOAuthStateWithProvider(tampered, SECRET)).toThrow(/signature|Malformed/i);
      expect(() => readOAuthStateWithProvider(state, 'wrong-secret')).toThrow(/signature/i);
    });
  });

  describe('verifyOAuthState', () => {
    it('passes when the embedded org matches the caller', () => {
      const state = createOAuthState(ORG, SECRET);
      expect(() => verifyOAuthState(state, ORG, SECRET)).not.toThrow();
    });

    it('rejects when the caller org differs from the state org (cross-org)', () => {
      const state = createOAuthState(ORG, SECRET);
      expect(() => verifyOAuthState(state, 'org_other', SECRET)).toThrow(/does not match/i);
    });
  });

  describe('pre-auth nonce state (createNonceState / verifyNonceState)', () => {
    it('round-trips: a freshly issued state verifies cleanly', () => {
      const state = createNonceState(SECRET);
      expect(() => verifyNonceState(state, SECRET)).not.toThrow();
    });

    it('rejects a tampered payload (signature mismatch)', () => {
      const state = createNonceState(SECRET);
      const [payload, sig] = state.split('.');
      const tampered = `${payload}x.${sig ?? ''}`;
      expect(() => verifyNonceState(tampered, SECRET)).toThrow(/signature|Malformed/i);
    });

    it('rejects a state signed with a different secret', () => {
      const state = createNonceState('a-completely-different-secret');
      expect(() => verifyNonceState(state, SECRET)).toThrow(/signature/i);
    });

    it('rejects a missing state', () => {
      expect(() => verifyNonceState(undefined, SECRET)).toThrow(/Missing/i);
    });

    it('rejects an expired state', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const state = createNonceState(SECRET);
      // Advance past the 10-minute TTL.
      vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
      expect(() => verifyNonceState(state, SECRET)).toThrow(/expired/i);
    });
  });
});
