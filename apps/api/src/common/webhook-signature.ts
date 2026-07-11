import { createHmac, timingSafeEqual } from 'node:crypto';

/** Prefix Meta uses on the `X-Hub-Signature-256` header value. */
const SHA256_PREFIX = 'sha256=';

/**
 * Verify a Meta `X-Hub-Signature-256` header against the raw request body.
 *
 * Meta signs the exact bytes it POSTs with HMAC-SHA256 keyed on the app secret
 * and sends the hex digest as `sha256=<digest>`. We recompute over the raw body
 * (never the re-serialized JSON, whose byte layout may differ) and compare in
 * constant time.
 *
 * @param rawBody   The unparsed request body bytes (`req.rawBody`).
 * @param signature The `X-Hub-Signature-256` header value, or undefined.
 * @param appSecret The Meta app secret (HMAC key).
 * @returns true only when the signature is present, well-formed, and matches.
 */
export function verifyMetaSignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  appSecret: string,
): boolean {
  if (!rawBody || !signature || !signature.startsWith(SHA256_PREFIX)) {
    return false;
  }

  const provided = signature.slice(SHA256_PREFIX.length);
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');

  // Compare as equal-length buffers; a length mismatch means "not equal" and
  // must not throw. Both sides are hex so byte length is deterministic.
  const providedBuf = Buffer.from(provided, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (providedBuf.length !== expectedBuf.length || providedBuf.length === 0) {
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}
