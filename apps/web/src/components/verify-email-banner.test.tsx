import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VerifyEmailBanner } from "./verify-email-banner";
import { ToastProvider } from "@/components/ui/toast";
import { resendVerification } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  resendVerification: vi.fn(),
}));

function renderBanner() {
  return render(
    <ToastProvider>
      <VerifyEmailBanner />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.mocked(resendVerification).mockReset();
  vi.mocked(resendVerification).mockResolvedValue(undefined);
});

describe("VerifyEmailBanner", () => {
  it("renders as a status region with the resend button", () => {
    renderBanner();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Please verify your email to secure your account.",
    );
    expect(
      screen.getByRole("button", { name: "Resend email" }),
    ).toBeInTheDocument();
  });

  it("clicking Resend calls resendVerification and shows a success toast", async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Resend email" }));

    expect(resendVerification).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Verification email sent.")).toBeInTheDocument();
  });

  it("clicking Resend disables and relabels the button while pending", async () => {
    let resolveResend: () => void = () => {};
    vi.mocked(resendVerification).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResend = () => resolve(undefined);
      }),
    );
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Resend email" }));

    const pendingButton = screen.getByRole("button", { name: "Sending…" });
    expect(pendingButton).toBeDisabled();

    resolveResend();
  });

  it("shows an error toast when resendVerification rejects", async () => {
    vi.mocked(resendVerification).mockRejectedValueOnce(
      new Error("Something broke"),
    );
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Resend email" }));

    expect(await screen.findByText("Something broke")).toBeInTheDocument();
  });

  it("the dismiss button hides the banner", async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Please verify your email to secure your account."),
    ).not.toBeInTheDocument();
  });
});
