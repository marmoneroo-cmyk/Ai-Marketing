import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoogleAuthButton } from "./google-auth-button";
import { mockLogin } from "@/lib/mock";

// Demo mode: a click must sign in locally (no API to redirect to) and land
// on the dashboard, exactly like the password form's demo fallback.
vi.mock("@/lib/env", () => ({
  API_BASE: "http://localhost:4000",
  DEMO_MODE: true,
}));

// See google-auth-button.test.tsx for why this needs vi.hoisted.
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

describe("GoogleAuthButton (demo mode)", () => {
  it("a click signs in with the shared demo session and goes straight to the dashboard", async () => {
    const user = userEvent.setup();
    render(<GoogleAuthButton />);

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(setToken).toHaveBeenCalledWith(mockLogin.accessToken);
    expect(push).toHaveBeenCalledWith("/dashboard");
  });
});
