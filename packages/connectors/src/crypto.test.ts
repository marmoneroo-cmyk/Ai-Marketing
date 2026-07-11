import { describe, test, expect, beforeEach } from 'vitest';
import { resetEnvCache } from '@brandpilot/config';
import { encryptToken, decryptToken, resetCryptoKeyCache } from './crypto';

// A deterministic 32-byte key, base64-encoded, so the derivation is exercised.
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

describe('token envelope encryption', () => {
  beforeEach(() => {
    // Arrange: a known encryption key, with caches reset between cases.
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.AUTH_SECRET = 'x'.repeat(16);
    process.env.ANTHROPIC_API_KEY = 'test';
    process.env.VOYAGE_API_KEY = 'test';
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
    resetEnvCache();
    resetCryptoKeyCache();
  });

  test('round-trips a plaintext token through encrypt then decrypt', () => {
    // Arrange
    const plaintext = 'EAAG-super-secret-access-token-1234567890';

    // Act
    const encrypted = encryptToken(plaintext);
    const decrypted = decryptToken(encrypted);

    // Assert
    expect(decrypted).toBe(plaintext);
  });

  test('produces a Buffer that is not the plaintext', () => {
    const plaintext = 'refresh-token-value';

    const encrypted = encryptToken(plaintext);

    expect(Buffer.isBuffer(encrypted)).toBe(true);
    expect(encrypted.toString('utf8')).not.toContain(plaintext);
  });

  test('uses a random IV so repeated encryptions differ', () => {
    const plaintext = 'same-input-every-time';

    const a = encryptToken(plaintext);
    const b = encryptToken(plaintext);

    // Ciphertext (and IV) differ, but both decrypt back to the same value.
    expect(a.equals(b)).toBe(false);
    expect(decryptToken(a)).toBe(plaintext);
    expect(decryptToken(b)).toBe(plaintext);
  });

  test('rejects a truncated / malformed payload', () => {
    const tooShort = Buffer.alloc(4, 1);

    expect(() => decryptToken(tooShort)).toThrow();
  });

  test('fails authentication when ciphertext is tampered with', () => {
    const encrypted = encryptToken('integrity-protected');

    // Flip a byte in the ciphertext region (after iv(12)+authTag(16)).
    const tampered = Buffer.from(encrypted);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0xff;

    expect(() => decryptToken(tampered)).toThrow();
  });
});
