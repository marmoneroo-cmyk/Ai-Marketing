import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '@brandpilot/core';

/** How long an issued OAuth `state` remains valid. */
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Decoded payload carried inside a signed OAuth `state` token. */
interface StatePayload {
  orgId: string;
  nonce: string;
  exp: number;
  /**
   * Optional target sub-provider for a multi-provider OAuth family (e.g. Meta
   * serves both `instagram` and `facebook` through one start/callback route
   * pair). Undefined for single-provider flows (TikTok) and for states issued
   * before this field existed.
   */
  provider?: string;
  /**
   * Optional in-app path to return the browser to after the callback (e.g.
   * `/onboarding` vs `/settings`), so a connect started from onboarding doesn't
   * eject the user to settings. Signed inside the state (cannot be tampered) and
   * still allow-listed by the callback before use, so it can't drive an open
   * redirect. Undefined for states issued before this field existed.
   */
  returnTo?: string;
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
 * Issue a signed, single-use OAuth `state` value binding the flow to `orgId`
 * (and, optionally, a target sub-provider — e.g. Meta's `instagram` vs
 * `facebook` — that the callback has no other way to recover, since a
 * provider redirect carries no other app state).
 *
 * Format: `base64url(JSON({orgId,nonce,exp,provider?})).base64url(HMAC-SHA256)`.
 * The HMAC is keyed on AUTH_SECRET so a caller cannot forge or tamper with the
 * payload, `nonce` makes each value unique, and `exp` bounds its lifetime.
 * Verified in the callback via {@link readOAuthState} or
 * {@link readOAuthStateWithProvider}.
 */
export function createOAuthState(
  orgId: string,
  secret: string,
  provider?: string,
  returnTo?: string,
): string {
  const payload: StatePayload = {
    orgId,
    nonce: randomBytes(16).toString('hex'),
    exp: Date.now() + STATE_TTL_MS,
    ...(provider !== undefined ? { provider } : {}),
    ...(returnTo !== undefined ? { returnTo } : {}),
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
 * Verify a `state`'s integrity (HMAC) and expiry, returning its decoded payload.
 * Throws `AppError('bad_request')` (→ HTTP 400) on any failure. Shared by
 * {@link readOAuthState} and {@link verifyOAuthState}.
 */
function decodeVerifiedState(state: string | undefined, secret: string): StatePayload {
  if (!state) {
    throw new AppError('bad_request', 'Missing OAuth `state` parameter');
  }

  const dot = state.indexOf('.');
  if (dot <= 0 || dot === state.length - 1) {
    throw new AppError('bad_request', 'Malformed OAuth state');
  }
  const payloadB64 = state.slice(0, dot);
  const providedSig = state.slice(dot + 1);

  if (!signaturesMatch(providedSig, sign(payloadB64, secret))) {
    throw new AppError('bad_request', 'Invalid OAuth state signature');
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadB64).toString('utf8')) as StatePayload;
  } catch {
    throw new AppError('bad_request', 'Malformed OAuth state payload');
  }

  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
    throw new AppError('bad_request', 'OAuth state has expired');
  }
  if (typeof payload.orgId !== 'string' || payload.orgId.length === 0) {
    throw new AppError('bad_request', 'OAuth state is missing an org');
  }
  return payload;
}

/**
 * Verify an OAuth `state` and RETURN the org it was issued for.
 *
 * This is how the OAuth callback establishes org context. A provider redirect
 * (Meta/TikTok) is a top-level, third-party browser navigation that CANNOT carry
 * the SPA's `Authorization: Bearer` token, so the callback route is `@Public()`
 * and instead trusts the signed `state`: the HMAC (keyed on AUTH_SECRET) proves
 * WE issued it for this org at `start`, and the expiry bounds the window. This is
 * the standard OAuth CSRF/session-binding mechanism.
 *
 * @param state   The `state` query param returned by the provider.
 * @param secret  AUTH_SECRET (the HMAC key used to issue the state).
 * @returns The `orgId` embedded in (and protected by) the state.
 */
export function readOAuthState(state: string | undefined, secret: string): string {
  return decodeVerifiedState(state, secret).orgId;
}

/**
 * Verify an OAuth `state` (same HMAC/expiry checks as {@link readOAuthState})
 * and return BOTH the org and the optional target sub-provider it was issued
 * for. Used by callbacks whose `start` route binds a sub-provider choice into
 * the state (e.g. Meta's `instagram` vs `facebook`) — `provider` is `undefined`
 * for states that never carried one (TikTok, or Meta states issued before this
 * field existed), letting the caller fall back to a sane default.
 *
 * @param state   The `state` query param returned by the provider.
 * @param secret  AUTH_SECRET (the HMAC key used to issue the state).
 */
export function readOAuthStateWithProvider(
  state: string | undefined,
  secret: string,
): { orgId: string; provider?: string; returnTo?: string } {
  const payload = decodeVerifiedState(state, secret);
  return {
    orgId: payload.orgId,
    ...(payload.provider !== undefined ? { provider: payload.provider } : {}),
    ...(payload.returnTo !== undefined ? { returnTo: payload.returnTo } : {}),
  };
}

/**
 * Verify an OAuth `state`: checks the HMAC (integrity), expiry, and that the
 * embedded `orgId` matches the caller's org. Throws `AppError('bad_request')`
 * (→ HTTP 400) on any failure. Use where the caller's org is already known (from
 * a JWT); the callback uses {@link readOAuthState} instead.
 *
 * @param state          The `state` query param returned by the provider.
 * @param expectedOrgId  The caller's current org (from the JWT).
 * @param secret         AUTH_SECRET (the HMAC key used to issue the state).
 */
export function verifyOAuthState(
  state: string | undefined,
  expectedOrgId: string,
  secret: string,
): void {
  const payload = decodeVerifiedState(state, secret);
  if (payload.orgId !== expectedOrgId) {
    throw new AppError('bad_request', 'OAuth state does not match the current org');
  }
}

/** Decoded payload for a PRE-AUTH signed state — no org exists yet. */
interface NonceStatePayload {
  nonce: string;
  exp: number;
}

/**
 * Issue a signed, single-use `state` for a PRE-AUTH OAuth flow — one that starts
 * before any session/org exists (e.g. "Continue with Google" on the signup/login
 * screen, where identity — and therefore the org — is only known once the
 * provider responds in the callback). Same construction as
 * {@link createOAuthState} (`base64url(JSON(payload)).base64url(HMAC-SHA256)`,
 * keyed on AUTH_SECRET) minus the `orgId` binding: the CSRF property comes
 * entirely from the nonce + signature + expiry. Verified via
 * {@link verifyNonceState}.
 */
export function createNonceState(secret: string): string {
  const payload: NonceStatePayload = {
    nonce: randomBytes(16).toString('hex'),
    exp: Date.now() + STATE_TTL_MS,
  };
  const payloadB64 = toBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Verify a pre-auth `state` issued by {@link createNonceState}: its HMAC
 * (integrity/authenticity — proves WE issued it) and expiry. Throws
 * `AppError('bad_request')` (→ HTTP 400) on ANY failure — missing, malformed,
 * tampered, signed with the wrong secret, or expired. Callers MUST call this
 * before doing any other work (token exchange, DB access) in a pre-auth OAuth
 * callback, so a forged/replayed state is rejected before it can cause any
 * side effect.
 */
export function verifyNonceState(state: string | undefined, secret: string): void {
  if (!state) {
    throw new AppError('bad_request', 'Missing OAuth `state` parameter');
  }

  const dot = state.indexOf('.');
  if (dot <= 0 || dot === state.length - 1) {
    throw new AppError('bad_request', 'Malformed OAuth state');
  }
  const payloadB64 = state.slice(0, dot);
  const providedSig = state.slice(dot + 1);

  if (!signaturesMatch(providedSig, sign(payloadB64, secret))) {
    throw new AppError('bad_request', 'Invalid OAuth state signature');
  }

  let payload: NonceStatePayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadB64).toString('utf8')) as NonceStatePayload;
  } catch {
    throw new AppError('bad_request', 'Malformed OAuth state payload');
  }

  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
    throw new AppError('bad_request', 'OAuth state has expired');
  }
}
