import { describe, expect, it } from "vitest";
import { isSessionLive, readJwtExpiry } from "./jwt";

const NOW = 1_700_000_000_000; // fixed clock (ms) for determinism
const NOW_SECONDS = NOW / 1000;

/** Build a syntactically-valid JWT with an arbitrary payload (signature is never verified here). */
function makeToken(payload: Record<string, unknown>): string {
  const encode = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("readJwtExpiry", () => {
  it("extracts a numeric exp claim", () => {
    expect(readJwtExpiry(makeToken({ exp: NOW_SECONDS + 60 }))).toBe(NOW_SECONDS + 60);
  });

  it("returns null when exp is absent", () => {
    expect(readJwtExpiry(makeToken({ sub: "u1" }))).toBeNull();
  });

  it("returns null for a non-numeric exp", () => {
    expect(readJwtExpiry(makeToken({ exp: "soon" }))).toBeNull();
  });

  it("returns null for a token that is not three parts", () => {
    expect(readJwtExpiry("not-a-jwt")).toBeNull();
    expect(readJwtExpiry("only.two")).toBeNull();
  });

  it("returns null for an unparseable payload", () => {
    expect(readJwtExpiry("aaa.!!!not-valid!!!.bbb")).toBeNull();
  });
});

describe("isSessionLive", () => {
  it("is false for a missing or empty token", () => {
    expect(isSessionLive(undefined, NOW)).toBe(false);
    expect(isSessionLive("", NOW)).toBe(false);
  });

  it("is true for a token whose exp is in the future", () => {
    expect(isSessionLive(makeToken({ exp: NOW_SECONDS + 3600 }), NOW)).toBe(true);
  });

  it("is false for a token whose exp has passed (the crash case)", () => {
    // An hour-old 1h token: still present in the mirror cookie but dead — it
    // must read as logged out, or it reaches SSR, 401s, and crashes the render.
    expect(isSessionLive(makeToken({ exp: NOW_SECONDS - 1 }), NOW)).toBe(false);
  });

  it("is false at the exact expiry instant (strictly-greater boundary)", () => {
    expect(isSessionLive(makeToken({ exp: NOW_SECONDS }), NOW)).toBe(false);
  });

  it("is false for a malformed or exp-less token even when present", () => {
    expect(isSessionLive("garbage", NOW)).toBe(false);
    expect(isSessionLive(makeToken({ sub: "u1" }), NOW)).toBe(false);
  });
});
