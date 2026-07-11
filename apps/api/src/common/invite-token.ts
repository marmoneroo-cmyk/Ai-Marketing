import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '@brandpilot/core';
import { ORG_INVITE_TTL_MS } from '@brandpilot/config';

/** Decoded payload carried inside a signed invite token. */
interface InvitePayload {
  orgId: string;
  inviteId: string;
  exp: number;
}

/** base64url-encode a buffer (no padding), safe for use in a URL query param. */
function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a base64url string back into a buffer. */
function fromBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** HMAC-SHA256 the payload segment, returned base64url. */
function sign(payloadB64: string, secret: string): string {
  return toBase64Url(createHmac('sha256', secret).update(payloadB64).digest());
}

/**
 * Issue a signed invite token binding `inviteId` to `orgId`.
 *
 * Format: `base64url(JSON({orgId,inviteId,exp})).base64url(HMAC-SHA256)`. The
 * HMAC is keyed on AUTH_SECRET so a caller cannot forge or tamper with the
 * payload, and `exp` bounds its lifetime (`ORG_INVITE_TTL_MS` from now). This
 * is the SAME construction as `oauth-state.ts`'s `createOAuthState`.
 *
 * Why a signed token instead of a stored hash (unlike password-reset /
 * email-verification): the accept flow is pre-auth — the invitee has no JWT
 * and the `org_invites` table is RLS-scoped to `app.org_id`, which pre-auth
 * requests cannot set. The signature itself proves WE issued this token for
 * this org + invite, letting the (later) accept endpoint establish org scope
 * before it ever queries the table. No `tokenHash` column is needed.
 */
export function createInviteToken(orgId: string, inviteId: string, secret: string): string {
  const payload: InvitePayload = {
    orgId,
    inviteId,
    exp: Date.now() + ORG_INVITE_TTL_MS,
  };
  const payloadB64 = toBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Constant-time equality for two base64url signature strings. */
function signaturesMatch(a: string, b: string): boolean {
  const bufA = fromBase64Url(a);
  const bufB = fromBase64Url(b);
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify an invite token's integrity (HMAC) and expiry, returning the
 * `orgId` + `inviteId` it was issued for. Throws `AppError('bad_request')`
 * (→ HTTP 400) on any failure — tampered, wrong-secret, malformed, or expired
 * — so a caller can't distinguish which case occurred.
 */
export function readInviteToken(
  token: string,
  secret: string,
): { orgId: string; inviteId: string } {
  if (!token) {
    throw new AppError('bad_request', 'Missing invite token');
  }

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) {
    throw new AppError('bad_request', 'Malformed invite token');
  }
  const payloadB64 = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  if (!signaturesMatch(providedSig, sign(payloadB64, secret))) {
    throw new AppError('bad_request', 'Invalid invite token signature');
  }

  let payload: InvitePayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadB64).toString('utf8')) as InvitePayload;
  } catch {
    throw new AppError('bad_request', 'Malformed invite token payload');
  }

  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
    throw new AppError('bad_request', 'Invite token has expired');
  }
  if (typeof payload.orgId !== 'string' || payload.orgId.length === 0) {
    throw new AppError('bad_request', 'Invite token is missing an org');
  }
  if (typeof payload.inviteId !== 'string' || payload.inviteId.length === 0) {
    throw new AppError('bad_request', 'Invite token is missing an invite id');
  }

  return { orgId: payload.orgId, inviteId: payload.inviteId };
}
