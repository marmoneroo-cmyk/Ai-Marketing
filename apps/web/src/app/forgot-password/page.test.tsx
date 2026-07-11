import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ForgotPasswordPage from "./page";
import { requestPasswordReset } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  requestPasswordReset: vi.fn(),
}));

const CONFIRMATION_TEXT =
  "If an account exists for that email, we've sent a password reset link. Check your inbox.";

beforeEach(() => {
  vi.mocked(requestPasswordReset).mockReset();
  vi.mocked(requestPasswordReset).mockResolvedValue(undefined);
});

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  email = "owner@luminaskin.co",
) {
  await user.type(screen.getByLabelText("Email"), email);
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
}

describe("ForgotPasswordPage", () => {
  it("submitting calls requestPasswordReset with the entered email and shows the generic confirmation", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await fillAndSubmit(user, "owner@luminaskin.co");

    expect(requestPasswordReset).toHaveBeenCalledWith("owner@luminaskin.co");
    expect(await screen.findByText(CONFIRMATION_TEXT)).toBeInTheDocument();
  });

  it("shows the same generic confirmation even when the api call rejects (anti-enumeration)", async () => {
    vi.mocked(requestPasswordReset).mockRejectedValueOnce(
      new Error("Network error"),
    );
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await fillAndSubmit(user, "someone@example.com");

    expect(await screen.findByText(CONFIRMATION_TEXT)).toBeInTheDocument();
  });

  it("the confirmation state includes a link back to sign in", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await fillAndSubmit(user);

    await screen.findByText(CONFIRMATION_TEXT);
    const backLink = screen.getByRole("link", { name: "Back to sign in" });
    expect(backLink).toHaveAttribute("href", "/login");
  });
});
