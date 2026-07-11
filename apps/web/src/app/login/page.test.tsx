import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./page";
import { login } from "@/lib/api";

const push = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => currentSearchParams,
}));

vi.mock("@/lib/api", () => ({
  login: vi.fn(),
  // GoogleAuthButton (rendered on this page) imports setToken directly.
  setToken: vi.fn(),
}));

beforeEach(() => {
  push.mockReset();
  vi.mocked(login).mockReset();
  currentSearchParams = new URLSearchParams();
});

describe("LoginPage", () => {
  it("renders a Continue with Google button above the email form", () => {
    render(<LoginPage />);

    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeInTheDocument();
  });

  it("signs in with the submitted credentials and redirects to the dashboard by default", async () => {
    const user = userEvent.setup();
    vi.mocked(login).mockResolvedValue({
      token: "tok",
      user: { id: "u1", email: "ava@luminaskin.co", name: "Ava", orgId: "o1", orgName: "Biz" },
    });
    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "ava@luminaskin.co");
    await user.type(screen.getByLabelText("Password"), "whatever-pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(login).toHaveBeenCalledWith("ava@luminaskin.co", "whatever-pw");
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects to a whitelisted ?next= route instead of the dashboard", async () => {
    const user = userEvent.setup();
    currentSearchParams = new URLSearchParams({ next: "/settings" });
    vi.mocked(login).mockResolvedValue({
      token: "tok",
      user: { id: "u1", email: "ava@luminaskin.co", name: "Ava", orgId: "o1", orgName: "Biz" },
    });
    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "ava@luminaskin.co");
    await user.type(screen.getByLabelText("Password"), "whatever-pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(push).toHaveBeenCalledWith("/settings");
  });

  it("shows the rejection message via role=alert when login fails, and never navigates", async () => {
    const user = userEvent.setup();
    vi.mocked(login).mockRejectedValue(new Error("Invalid email or password."));
    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "ava@luminaskin.co");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('surfaces "email already registered" for ?oauth_error=email_registered', () => {
    currentSearchParams = new URLSearchParams({ oauth_error: "email_registered" });
    render(<LoginPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "That email is registered — sign in with your password.",
    );
  });

  it.each(["google_unavailable", "google_failed"])(
    "surfaces a generic Google sign-in message for ?oauth_error=%s",
    (code) => {
      currentSearchParams = new URLSearchParams({ oauth_error: code });
      render(<LoginPage />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Google sign-in isn't available right now.",
      );
    },
  );

  it("shows no alert when there is no oauth_error and no submit has happened yet", () => {
    render(<LoginPage />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores an unrecognized oauth_error code (shows no alert)", () => {
    currentSearchParams = new URLSearchParams({ oauth_error: "something_else" });
    render(<LoginPage />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
