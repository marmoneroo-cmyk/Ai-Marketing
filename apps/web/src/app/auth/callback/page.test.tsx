import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import AuthCallbackPage from "./page";
import { setToken } from "@/lib/api";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("@/lib/api", () => ({
  setToken: vi.fn(),
}));

beforeEach(() => {
  replace.mockReset();
  vi.mocked(setToken).mockReset();
  window.location.hash = "";
});

describe("AuthCallbackPage", () => {
  it("stores the token found in the URL fragment and continues to onboarding", () => {
    window.location.hash = "#token=abc.def.ghi";
    render(<AuthCallbackPage />);

    expect(setToken).toHaveBeenCalledWith("abc.def.ghi");
    expect(replace).toHaveBeenCalledWith("/onboarding");
  });

  it("URL-decodes the token from the fragment", () => {
    window.location.hash = `#token=${encodeURIComponent("a.b/c+d")}`;
    render(<AuthCallbackPage />);

    expect(setToken).toHaveBeenCalledWith("a.b/c+d");
  });

  it("sends the user back to login with a generic error when no token is present", () => {
    render(<AuthCallbackPage />);

    expect(setToken).not.toHaveBeenCalled();
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

    expect(setToken).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
