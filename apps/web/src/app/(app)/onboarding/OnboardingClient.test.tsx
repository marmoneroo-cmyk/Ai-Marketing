import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { OnboardingClient } from "./OnboardingClient";
import { hasOAuthStart, getDna } from "@/lib/api";
import type { ConnectedChannel } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  runDiscovery: vi.fn(),
  getDna: vi.fn(),
  hasOAuthStart: vi.fn(),
  startConnect: vi.fn(),
  getConnectorAvailability: vi.fn(async () => ({
    instagram: true,
    facebook: true,
    tiktok: true,
  })),
}));

const ONE_CONNECTED: ConnectedChannel[] = [
  {
    provider: "instagram",
    status: "connected",
    handle: "@luminaskin.co",
    connectedAt: "2026-06-14T10:00:00Z",
  },
  { provider: "facebook", status: "disconnected", handle: null, connectedAt: null },
  { provider: "tiktok", status: "disconnected", handle: null, connectedAt: null },
];

const NONE_CONNECTED: ConnectedChannel[] = ONE_CONNECTED.map((c) => ({
  ...c,
  status: "disconnected",
  handle: null,
  connectedAt: null,
}));

const ALL_CONNECTED: ConnectedChannel[] = ONE_CONNECTED.map((c) => ({
  ...c,
  status: "connected",
}));

beforeEach(() => {
  vi.mocked(hasOAuthStart).mockReset();
  vi.mocked(hasOAuthStart).mockReturnValue(true);
  vi.mocked(getDna).mockReset();
  vi.mocked(getDna).mockResolvedValue({ profile: null, personas: [], competitors: [] });
});

describe("OnboardingClient", () => {
  it("shows a real Connected confirmation for a channel the API reports as connected", () => {
    render(<OnboardingClient channels={ONE_CONNECTED} />);

    const connectedButton = screen.getByRole("button", {
      name: "Instagram — connected",
    });
    expect(connectedButton).toBeDisabled();

    // Untouched channels stay actionable Connect CTAs.
    expect(
      screen.getByRole("button", { name: "Connect Facebook" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect TikTok" }),
    ).toBeInTheDocument();
  });

  it("shows a truthful 'connected' progress line reflecting the real connected count", () => {
    render(<OnboardingClient channels={ONE_CONNECTED} />);

    expect(screen.getByText("✓ 1 channel connected")).toBeInTheDocument();
  });

  it("pluralizes and counts correctly when every channel is connected", () => {
    render(<OnboardingClient channels={ALL_CONNECTED} />);

    expect(screen.getByText("✓ 3 channels connected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Facebook — connected" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "TikTok — connected" }),
    ).toBeDisabled();
  });

  it("prompts the user to connect instead of claiming progress when nothing is connected", () => {
    render(<OnboardingClient channels={NONE_CONNECTED} />);

    expect(
      screen.getByText(
        "Connect at least one channel below, or skip ahead to step 2 (website).",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("✓ 0 channels connected")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /— connected$/ })).not.toBeInTheDocument();
  });

  it("does not claim the website/discovery step is complete just because channels are connected", () => {
    render(<OnboardingClient channels={ALL_CONNECTED} />);

    // The Business DNA result card (an h3-titled Card) only ever appears once
    // discovery actually populates it in this session — connecting channels
    // must not fake that. (The intro copy also mentions "Business DNA" in
    // prose, so this asserts on the result card's heading specifically.)
    expect(
      screen.queryByRole("heading", { name: "Business DNA" }),
    ).not.toBeInTheDocument();
  });
});
