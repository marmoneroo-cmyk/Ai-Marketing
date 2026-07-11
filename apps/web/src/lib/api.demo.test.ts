import { describe, it, expect, vi, afterEach } from "vitest";
import { getApprovals, sendReply } from "./api";
import { mockAllApprovals } from "./mock";

/**
 * Demo mode: getApprovals must fall back to the mock approvals queue when the
 * API is unreachable — mirrors google-auth-button.demo.test.tsx's approach of
 * forcing DEMO_MODE true via a module mock, then letting the real fetch (no
 * backend listening on localhost:4000) fail naturally so withFallback catches
 * it and returns the fallback.
 */
vi.mock("./env", () => ({
  API_BASE: "http://localhost:4000",
  DEMO_MODE: true,
}));

describe("getApprovals (demo mode)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the mock approvals queue when the API is unreachable", async () => {
    const approvals = await getApprovals();
    expect(approvals).toEqual(mockAllApprovals);
  });
});

describe("sendReply (demo mode)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("synthesizes a local outbound human message when the API is unreachable", async () => {
    const message = await sendReply("cnv_01", "See you Saturday at 2:30!");

    expect(message).toMatchObject({
      direction: "outbound",
      author: "human",
      body: "See you Saturday at 2:30!",
    });
    expect(typeof message.id).toBe("string");
    expect(message.id.length).toBeGreaterThan(0);
    // A real, parseable timestamp — not fabricated/omitted.
    expect(Number.isNaN(Date.parse(message.createdAt))).toBe(false);
  });
});
