import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { loadEnv } from '@brandpilot/config';
import { AppError } from '@brandpilot/core';

/**
 * Envelope encryption for OAuth tokens at rest (stored as `bytea` in
 * `connector_tokens`). AES-256-GCM with a random IV per message; the on-disk
 * layout is `iv(12) || authTag(16) || ciphertext`.
 *
 * The data key is derived from `TOKEN_ENCRYPTION_KEY` (base64) via SHA-256 so
 * the key is always exactly 32 bytes regardless of the configured secret's
 * length. Callers only ever see plaintext strings and opaque `Buffer`s.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard nonce length
const AUTH_TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;

/** Derive (once) the 32-byte AES key from the configured base64 secret. */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = loadEnv().TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new AppError('bad_request', 'TOKEN_ENCRYPTION_KEY is not configured');
  }
  // Accept any base64 secret; SHA-256 normalizes it to a 32-byte key.
  const raw = Buffer.from(secret, 'base64');
  const material = raw.length > 0 ? raw : Buffer.from(secret, 'utf8');
  cachedKey = createHash('sha256').update(material).digest();
  return cachedKey;
}

/** Encrypt a plaintext token into an opaque, storable buffer. */
export function encryptToken(plaintext: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

/** Decrypt a buffer produced by {@link encryptToken} back into plaintext. */
export function decryptToken(buf: Buffer): string {
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new AppError('bad_request', 'Encrypted token payload is malformed');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Test helper: drop the memoized key (e.g. after mutating env in a test). */
export function resetCryptoKeyCache(): void {
  cachedKey = null;
}
