import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoogleAuthButton } from "./google-auth-button";

// Real (non-demo) mode: a click must navigate the browser away, never fetch.
vi.mock("@/lib/env", () => ({
  API_BASE: "http://localhost:4000",
  DEMO_MODE: false,
}));

// vi.mock factories are hoisted above top-level const declarations, so a
// factory that dereferences an outer const directly (not inside a nested
// closure) hits the temporal dead zone unless the const itself is created via
// vi.hoisted (mirrors apps/api/src/auth/auth.service.spec.ts's `logger` mock).
const { push, setToken } = vi.hoisted(() => ({
  push: vi.fn(),
  setToken: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/api", () => ({
  setToken,
}));

beforeEach(() => {
  push.mockReset();
  setToken.mockReset();
});

describe("GoogleAuthButton (real mode)", () => {
  it('renders a "Continue with Google" button', () => {
    render(<GoogleAuthButton />);
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeInTheDocument();
  });

  describe("click behavior", () => {
    const originalLocation = window.location;

    beforeEach(() => {
      // Replace `window.location` with a plain, fully-controlled object so the
      // click handler's `window.location.href = …` assignment is a normal
      // property write we can assert on, instead of going through jsdom's
      // (unimplemented) real navigation.
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...originalLocation, href: "" },
      });
    });

    afterEach(() => {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    });

    it("navigates the browser to the API's /auth/google start route, and never calls setToken", async () => {
      const user = userEvent.setup();
      render(<GoogleAuthButton />);

      await user.click(screen.getByRole("button", { name: "Continue with Google" }));

      expect(window.location.href).toBe("http://localhost:4000/auth/google");
      expect(setToken).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
    });
  });
});
