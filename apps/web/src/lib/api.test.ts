import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { login, register } from "./api";

/**
 * Regression guard for the auth response-shape bug: the API returns
 * `{ accessToken }`, and `login`/`register` must persist THAT. The previous code
 * read a non-existent `.token` field, so against a real backend it stored the
 * literal string `"undefined"` as the bearer token and every subsequent request
 * 401'd — invisible in the demo because the mock happened to carry a `.token`.
 */
function stubFetchWith(data: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data }),
    }),
  );
}

describe("api.ts — auth token persistence (real API response shape)", () => {
  beforeEach(() => {
    document.cookie = "brandpilot_token=; path=/; max-age=0; SameSite=Lax";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("login() persists the API's { accessToken }, never a non-existent .token", async () => {
    stubFetchWith({ accessToken: "real-jwt-login" });
    await login("owner@acme.com", "Sup3r!pass");
    expect(document.cookie).toContain("brandpilot_token=real-jwt-login");
    expect(document.cookie).not.toContain("brandpilot_token=undefined");
  });

  it("register() persists the API's { accessToken }", async () => {
    stubFetchWith({ accessToken: "real-jwt-register" });
    await register({ orgName: "Acme", email: "owner@acme.com", password: "Sup3r!pass" });
    expect(document.cookie).toContain("brandpilot_token=real-jwt-register");
    expect(document.cookie).not.toContain("brandpilot_token=undefined");
  });
});
