import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import VerifyEmailPage from "./page";
import { verifyEmail } from "@/lib/api";

let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => currentSearchParams,
}));

vi.mock("@/lib/api", () => ({
  verifyEmail: vi.fn(),
}));

const VALID_TOKEN = "verify-token-123";

beforeEach(() => {
  vi.mocked(verifyEmail).mockReset();
  vi.mocked(verifyEmail).mockResolvedValue(undefined);
  currentSearchParams = new URLSearchParams({ token: VALID_TOKEN });
});

describe("VerifyEmailPage", () => {
  it("renders the error state directly and never calls the api when the token is missing", () => {
    currentSearchParams = new URLSearchParams();
    render(<VerifyEmailPage />);

    expect(
      screen.getByText(
        "This verification link is invalid or has expired.",
      ),
    ).toBeInTheDocument();
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it("with a token, calls verifyEmail with it and renders the success state", async () => {
    render(<VerifyEmailPage />);

    expect(verifyEmail).toHaveBeenCalledWith(VALID_TOKEN);
    expect(await screen.findByText("Your email is verified.")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Go to dashboard" });
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("a rejected verifyEmail renders the error state via role=alert", async () => {
    vi.mocked(verifyEmail).mockRejectedValueOnce(new Error("Token expired."));
    render(<VerifyEmailPage />);

    expect(
      await screen.findByText("This verification link is invalid or has expired."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This verification link is invalid or has expired.",
    );
  });

  it("fires verifyEmail exactly once under React.StrictMode's effect double-invoke", async () => {
    // React 19 dev-mode StrictMode double-invokes effects on the SAME mounted
    // instance (setup -> cleanup -> setup again) to catch non-idempotent
    // effects — it does not unmount/remount a fresh instance. The once-guard
    // (a useRef latch inside the page, set synchronously before the `await`)
    // must make the 2nd setup a no-op; otherwise the 2nd call would consume
    // an already-used token and could flip a real success into an error.
    render(
      <StrictMode>
        <VerifyEmailPage />
      </StrictMode>,
    );

    expect(await screen.findByText("Your email is verified.")).toBeInTheDocument();
    expect(verifyEmail).toHaveBeenCalledTimes(1);
  });
});
