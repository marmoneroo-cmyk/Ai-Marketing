import { randomBytes, createHash } from 'node:crypto';

/** A freshly minted one-time token: the raw value plus its stored hash. */
export interface OneTimeToken {
  raw: string;
  hash: string;
}

/**
 * Generate a one-time token for flows like password reset or (future)
 * email verification. `raw` is a 256-bit random value, URL-safe (base64url),
 * delivered to the user (e.g. in an email link) and never persisted or
 * logged. `hash` is its SHA-256 hex digest — that's the only form that ever
 * gets written to the database, so a database read can never yield a usable
 * token.
 *
 * Pure module: no framework dependencies, reusable anywhere a single-use,
 * hash-stored token is needed.
 */
export function generateOneTimeToken(): OneTimeToken {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashOneTimeToken(raw) };
}

/** Hash a raw one-time token for lookup against the persisted hash. */
export function hashOneTimeToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
