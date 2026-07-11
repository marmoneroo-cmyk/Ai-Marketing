import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SocialConnectButton } from "./SocialConnectButton";
import { hasOAuthStart, startConnect } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  hasOAuthStart: vi.fn(),
  startConnect: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(hasOAuthStart).mockReset();
  vi.mocked(hasOAuthStart).mockReturnValue(true);
  vi.mocked(startConnect).mockReset();
});

describe("SocialConnectButton", () => {
  describe("connected state", () => {
    it("card variant: renders a disabled Connected control (check + text) instead of the Connect CTA", async () => {
      const user = userEvent.setup();
      render(
        <SocialConnectButton
          provider="instagram"
          label="Instagram"
          variant="card"
          connected
        />,
      );

      const button = screen.getByRole("button", {
        name: "Instagram — connected",
      });
      expect(button).toBeDisabled();
      expect(screen.getByText("Connected")).toBeInTheDocument();
      expect(screen.queryByText("Connect →")).not.toBeInTheDocument();
      expect(screen.queryByText("Connecting…")).not.toBeInTheDocument();

      await user.click(button);
      expect(startConnect).not.toHaveBeenCalled();
    });

    it("pill variant: renders a disabled Connected indicator and never starts OAuth on click", async () => {
      const user = userEvent.setup();
      render(
        <SocialConnectButton
          provider="facebook"
          label="Facebook"
          variant="pill"
          connected
        />,
      );

      const button = screen.getByRole("button", {
        name: "Facebook — connected",
      });
      expect(button).toBeDisabled();
      expect(screen.getByText("Connected")).toBeInTheDocument();

      await user.click(button);
      expect(startConnect).not.toHaveBeenCalled();
    });
  });

  describe("existing (non-connected) behavior is unaffected", () => {
    it("card variant: still renders the actionable Connect CTA when connected is absent", () => {
      render(
        <SocialConnectButton provider="instagram" label="Instagram" variant="card" />,
      );

      const button = screen.getByRole("button", { name: "Connect Instagram" });
      expect(button).not.toBeDisabled();
      expect(screen.getByText("Connect →")).toBeInTheDocument();
    });

    it("card variant: still renders the disabled Coming soon control for a provider without OAuth start", () => {
      vi.mocked(hasOAuthStart).mockReturnValue(false);
      render(<SocialConnectButton provider="youtube" label="YouTube" variant="card" />);

      const button = screen.getByRole("button", { name: "YouTube — coming soon" });
      expect(button).toBeDisabled();
      expect(screen.getByText("Coming soon")).toBeInTheDocument();
    });

    it("pill variant: still renders the plain label when connected is absent", () => {
      render(<SocialConnectButton provider="facebook" label="Facebook" variant="pill" />);

      const button = screen.getByRole("button", { name: "Connect Facebook" });
      expect(button).not.toBeDisabled();
      expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    });
  });
});
