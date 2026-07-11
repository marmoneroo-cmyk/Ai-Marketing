import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import AuthCallbackPage from "./page";
import { setSession } from "@/lib/api";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("@/lib/api", () => ({
  setSession: vi.fn(),
}));

beforeEach(() => {
  replace.mockReset();
  vi.mocked(setSession).mockReset();
  window.location.hash = "";
});

describe("AuthCallbackPage", () => {
  it("stores the access token found in the URL fragment and continues to onboarding", () => {
    window.location.hash = "#token=abc.def.ghi";
    render(<AuthCallbackPage />);

    expect(setSession).toHaveBeenCalledWith("abc.def.ghi", undefined);
    expect(replace).toHaveBeenCalledWith("/onboarding");
  });

  it("stores BOTH the access and refresh tokens when the fragment carries them", () => {
    window.location.hash = "#token=abc.def.ghi&refresh=r1.r2.r3";
    render(<AuthCallbackPage />);

    expect(setSession).toHaveBeenCalledWith("abc.def.ghi", "r1.r2.r3");
    expect(replace).toHaveBeenCalledWith("/onboarding");
  });

  it("URL-decodes the tokens from the fragment", () => {
    window.location.hash = `#token=${encodeURIComponent("a.b/c+d")}&refresh=${encodeURIComponent("r/x+y")}`;
    render(<AuthCallbackPage />);

    expect(setSession).toHaveBeenCalledWith("a.b/c+d", "r/x+y");
  });

  it("sends the user back to login with a generic error when no token is present", () => {
    render(<AuthCallbackPage />);

    expect(setSession).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/login?oauth_error=google_failed");
  });

  it('shows a "Signing you in…" status panel', () => {
    render(<AuthCallbackPage />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Signing you in");
  });

  it("fires the hand-off exactly once under React.StrictMode's effect double-invoke", () => {
    window.location.hash = "#token=abc.def.ghi";
    render(
      <StrictMode>
        <AuthCallbackPage />
      </StrictMode>,
    );

    expect(setSession).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
