import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResetPasswordPage from "./page";
import { resetPassword } from "@/lib/api";

const push = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => currentSearchParams,
}));

vi.mock("@/lib/api", () => ({
  resetPassword: vi.fn(),
}));

const VALID_TOKEN = "reset-token-123";
// Must satisfy the shared password policy (@brandpilot/core's PASSWORD_RULES):
// uppercase, lowercase, a digit, and a special character, min 8 chars.
const VALID_PASSWORD = "Correct-Horse-1!";

beforeEach(() => {
  push.mockReset();
  vi.mocked(resetPassword).mockReset();
  vi.mocked(resetPassword).mockResolvedValue(undefined);
  currentSearchParams = new URLSearchParams({ token: VALID_TOKEN });
});

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  password: string,
  confirmPassword: string,
) {
  await user.type(screen.getByLabelText("New password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirmPassword);
  await user.click(screen.getByRole("button", { name: "Reset password" }));
}

describe("ResetPasswordPage", () => {
  it("renders the invalid-link error state when the token is missing", () => {
    currentSearchParams = new URLSearchParams();
    render(<ResetPasswordPage />);

    expect(
      screen.getByText("This reset link is invalid or has expired."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reset password" }),
    ).not.toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();

    const link = screen.getByRole("link", { name: "Request a new link" });
    expect(link).toHaveAttribute("href", "/forgot-password");
  });

  it("mismatched passwords block submit with an inline error and don't call the api", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await fillForm(user, VALID_PASSWORD, "a-different-password");

    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("matching passwords call resetPassword with the token and password", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await fillForm(user, VALID_PASSWORD, VALID_PASSWORD);

    expect(resetPassword).toHaveBeenCalledWith(VALID_TOKEN, VALID_PASSWORD);
    expect(await screen.findByText(/Your password has been updated/)).toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/login");
  });

  it("surfaces an api rejection (e.g. expired token) via the alert block", async () => {
    vi.mocked(resetPassword).mockRejectedValueOnce(
      new Error("This reset link has expired."),
    );
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await fillForm(user, VALID_PASSWORD, VALID_PASSWORD);

    expect(
      await screen.findByText("This reset link has expired."),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("disables the submit button and swaps its label while pending", async () => {
    let resolveReset: () => void = () => {};
    vi.mocked(resetPassword).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReset = () => resolve(undefined);
      }),
    );
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByLabelText("New password"), VALID_PASSWORD);
    await user.type(screen.getByLabelText("Confirm password"), VALID_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    const pendingButton = screen.getByRole("button", { name: "Resetting…" });
    expect(pendingButton).toBeDisabled();

    resolveReset();
  });
});
