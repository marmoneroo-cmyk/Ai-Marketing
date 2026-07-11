/**
 * Minimal, dependency-free JWT inspection for client/edge route-gating.
 *
 * These helpers only READ the unverified payload to decide whether a token is
 * worth sending — the API remains the security boundary that verifies the
 * signature. Deliberately free of Next.js imports so the logic can be
 * unit-tested in isolation and reused from both the route proxy and the browser.
 */

/**
 * Read the `exp` claim (seconds since epoch) from a JWT payload WITHOUT
 * verifying its signature. Returns null for anything that isn't a well-formed
 * three-part JWT carrying a numeric `exp`.
 */
export function readJwtExpiry(token: string): number | null {
  const parts = token.split(".");
  const payloadPart = parts[1];
  if (parts.length !== 3 || !payloadPart) return null;
  try {
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * A token counts as a live session only if it parses and hasn't expired.
 * Presence alone is NOT enough: the client mirrors the token into a 7-day cookie
 * (see setToken in lib/api.ts) but the JWT expires sooner, so a present-but-
 * expired token must read as logged-out — otherwise it reaches the SSR data
 * fetch, 401s, and crashes the Server Component render.
 *
 * `now` (epoch ms) is injectable for deterministic tests; defaults to the wall
 * clock.
 */
export function isSessionLive(
  token: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!token) return false;
  const exp = readJwtExpiry(token);
  if (exp === null) return false;
  return exp * 1000 > now;
}
