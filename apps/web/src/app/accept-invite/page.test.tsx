import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AcceptInvitePage from "./page";
import { acceptInvite, getInvitePreview } from "@/lib/api";
import type { InvitePreview } from "@/lib/types";

const push = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => currentSearchParams,
}));

vi.mock("@/lib/api", () => ({
  getInvitePreview: vi.fn(),
  acceptInvite: vi.fn(),
}));

const VALID_TOKEN = "invite-token-123";
// Must satisfy the shared password policy (@brandpilot/core's PASSWORD_RULES):
// uppercase, lowercase, a digit, and a special character, min 8 chars.
const VALID_PASSWORD = "Correct-Horse-1!";

const PREVIEW_NEEDS_PASSWORD: InvitePreview = {
  orgName: "Lumina Skin Studio",
  email: "jordan@luminaskin.co",
  role: "marketer",
  needsPassword: true,
};

const PREVIEW_EXISTING_USER: InvitePreview = {
  orgName: "Lumina Skin Studio",
  email: "ava@luminaskin.co",
  role: "admin",
  needsPassword: false,
};

beforeEach(() => {
  push.mockReset();
  vi.mocked(getInvitePreview).mockReset();
  vi.mocked(acceptInvite).mockReset();
  vi.mocked(getInvitePreview).mockResolvedValue(PREVIEW_NEEDS_PASSWORD);
  vi.mocked(acceptInvite).mockResolvedValue({ token: "session-token" });
  currentSearchParams = new URLSearchParams({ token: VALID_TOKEN });
});

async function fillPasswordForm(
  user: ReturnType<typeof userEvent.setup>,
  password: string,
  confirmPassword: string,
) {
  await user.type(screen.getByLabelText("Password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirmPassword);
  await user.click(
    screen.getByRole("button", { name: "Accept & create account" }),
  );
}

describe("AcceptInvitePage", () => {
  it("renders the invalid state without calling the api when the token is missing", () => {
    currentSearchParams = new URLSearchParams();
    render(<AcceptInvitePage />);

    expect(
      screen.getByText("This invitation is invalid or has expired."),
    ).toBeInTheDocument();
    expect(getInvitePreview).not.toHaveBeenCalled();

    const link = screen.getByRole("link", { name: "Back to sign in" });
    expect(link).toHaveAttribute("href", "/login");
  });

  it("a rejected getInvitePreview renders the invalid state via role=alert", async () => {
    vi.mocked(getInvitePreview).mockRejectedValueOnce(
      new Error("Invite expired."),
    );
    render(<AcceptInvitePage />);

    expect(
      await screen.findByText("This invitation is invalid or has expired."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This invitation is invalid or has expired.",
    );
  });

  it("fires getInvitePreview exactly once under React.StrictMode's effect double-invoke", async () => {
    // Same StrictMode-safe guard as verify-email/page.tsx: React 19 dev-mode
    // StrictMode double-invokes effects on the SAME mounted instance
    // (setup -> cleanup -> setup again). The useRef latch, set synchronously
    // before the `await`, must make the 2nd setup a no-op.
    render(
      <StrictMode>
        <AcceptInvitePage />
      </StrictMode>,
    );

    expect(
      await screen.findByText("You’ve been invited to join Lumina Skin Studio"),
    ).toBeInTheDocument();
    expect(getInvitePreview).toHaveBeenCalledTimes(1);
    expect(getInvitePreview).toHaveBeenCalledWith(VALID_TOKEN);
  });

  describe("when needsPassword is true (new user)", () => {
    it("renders password + confirm password fields", async () => {
      render(<AcceptInvitePage />);

      expect(await screen.findByLabelText("Password")).toBeInTheDocument();
      expect(screen.getByLabelText("Confirm password")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Accept & create account" }),
      ).toBeInTheDocument();
    });

    it("shows the invited org, role, and email", async () => {
      render(<AcceptInvitePage />);

      expect(
        await screen.findByText("You’ve been invited to join Lumina Skin Studio"),
      ).toBeInTheDocument();
      expect(screen.getByText("as Marketer")).toBeInTheDocument();
      expect(screen.getByText("jordan@luminaskin.co")).toBeInTheDocument();
    });

    it("mismatched passwords block submit with an inline error and don't call the api", async () => {
      const user = userEvent.setup();
      render(<AcceptInvitePage />);
      await screen.findByLabelText("Password");

      await fillPasswordForm(user, VALID_PASSWORD, "a-different-password");

      expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
      expect(acceptInvite).not.toHaveBeenCalled();
    });

    it("matching passwords call acceptInvite with token + password and redirect to /dashboard", async () => {
      const user = userEvent.setup();
      render(<AcceptInvitePage />);
      await screen.findByLabelText("Password");

      await fillPasswordForm(user, VALID_PASSWORD, VALID_PASSWORD);

      expect(acceptInvite).toHaveBeenCalledWith({
        token: VALID_TOKEN,
        password: VALID_PASSWORD,
      });
      expect(push).toHaveBeenCalledWith("/dashboard");
    });

    it("includes a trimmed name when provided", async () => {
      const user = userEvent.setup();
      render(<AcceptInvitePage />);
      await screen.findByLabelText("Password");

      await user.type(screen.getByLabelText("Your name"), "  Ava Chen  ");
      await fillPasswordForm(user, VALID_PASSWORD, VALID_PASSWORD);

      expect(acceptInvite).toHaveBeenCalledWith({
        token: VALID_TOKEN,
        password: VALID_PASSWORD,
        name: "Ava Chen",
      });
    });

    it("surfaces an api rejection via the alert block and keeps the form populated", async () => {
      vi.mocked(acceptInvite).mockRejectedValueOnce(
        new Error("This invitation has expired."),
      );
      const user = userEvent.setup();
      render(<AcceptInvitePage />);
      await screen.findByLabelText("Password");

      await fillPasswordForm(user, VALID_PASSWORD, VALID_PASSWORD);

      expect(
        await screen.findByText("This invitation has expired."),
      ).toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Password")).toHaveValue(VALID_PASSWORD);
    });

    it("disables the submit button and swaps its label while pending", async () => {
      let resolveAccept: (value: { token: string }) => void = () => {};
      vi.mocked(acceptInvite).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveAccept = resolve;
        }),
      );
      const user = userEvent.setup();
      render(<AcceptInvitePage />);
      await screen.findByLabelText("Password");

      await user.type(screen.getByLabelText("Password"), VALID_PASSWORD);
      await user.type(
        screen.getByLabelText("Confirm password"),
        VALID_PASSWORD,
      );
      await user.click(
        screen.getByRole("button", { name: "Accept & create account" }),
      );

      const pendingButton = screen.getByRole("button", { name: "Accepting…" });
      expect(pendingButton).toBeDisabled();

      resolveAccept({ token: "session-token" });
    });
  });

  describe("when needsPassword is false (existing user)", () => {
    beforeEach(() => {
      vi.mocked(getInvitePreview).mockResolvedValue(PREVIEW_EXISTING_USER);
    });

    it("renders no password field and an 'Accept invitation' button", async () => {
      render(<AcceptInvitePage />);

      expect(
        await screen.findByRole("button", { name: "Accept invitation" }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("Confirm password"),
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
    });

    it("calls acceptInvite with just the token and redirects to /dashboard", async () => {
      const user = userEvent.setup();
      render(<AcceptInvitePage />);

      await user.click(
        await screen.findByRole("button", { name: "Accept invitation" }),
      );

      expect(acceptInvite).toHaveBeenCalledWith({ token: VALID_TOKEN });
      expect(push).toHaveBeenCalledWith("/dashboard");
    });
  });
});
