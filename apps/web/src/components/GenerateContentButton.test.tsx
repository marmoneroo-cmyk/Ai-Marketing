import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GenerateContentButton } from "./GenerateContentButton";
import { ToastProvider } from "@/components/ui/toast";
import { generateContentPlan } from "@/lib/api";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/lib/api", () => ({
  generateContentPlan: vi.fn().mockResolvedValue({ jobId: "j1" }),
}));

function renderButton() {
  return render(
    <ToastProvider>
      <GenerateContentButton />
    </ToastProvider>,
  );
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: "Generate this week's content" }),
  );
}

beforeEach(() => {
  vi.mocked(generateContentPlan).mockReset();
  vi.mocked(generateContentPlan).mockResolvedValue({ jobId: "j1" });
  refresh.mockReset();
});

describe("GenerateContentButton", () => {
  it("opens the picker panel with format chips and the hint when clicked", async () => {
    const user = userEvent.setup();
    renderButton();

    // Panel is not rendered before the click.
    expect(
      screen.queryByRole("button", { name: "Post" }),
    ).not.toBeInTheDocument();

    await openPicker(user);

    expect(screen.getByRole("button", { name: "Post" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Carousel" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Story" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reel" })).toBeInTheDocument();
    expect(
      screen.getByText("Leave empty to let BrandPilot decide"),
    ).toBeInTheDocument();
  });

  it("sets aria-expanded on the trigger and exposes the panel as a labeled group", async () => {
    const user = userEvent.setup();
    renderButton();

    const trigger = screen.getByRole("button", {
      name: "Generate this week's content",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await openPicker(user);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("group", { name: "Content formats" }),
    ).toBeInTheDocument();
  });

  it("returns focus to the trigger after a successful generate and shows a persistent queued status", async () => {
    const user = userEvent.setup();
    renderButton();
    await openPicker(user);

    await user.click(screen.getByRole("button", { name: "Generate" }));

    const trigger = screen.getByRole("button", {
      name: "Generate this week's content",
    });
    expect(trigger).toHaveFocus();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      "Queued — new drafts will appear shortly",
    );
  });

  it("toggles a chip's aria-pressed state true -> false -> true", async () => {
    const user = userEvent.setup();
    renderButton();
    await openPicker(user);

    const reelChip = screen.getByRole("button", { name: "Reel" });
    expect(reelChip).toHaveAttribute("aria-pressed", "false");

    await user.click(reelChip);
    expect(reelChip).toHaveAttribute("aria-pressed", "true");

    await user.click(reelChip);
    expect(reelChip).toHaveAttribute("aria-pressed", "false");

    await user.click(reelChip);
    expect(reelChip).toHaveAttribute("aria-pressed", "true");
  });

  it("calls generateContentPlan with selected formats and closes the panel", async () => {
    const user = userEvent.setup();
    renderButton();
    await openPicker(user);

    await user.click(screen.getByRole("button", { name: "Reel" }));
    await user.click(screen.getByRole("button", { name: "Carousel" }));

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(generateContentPlan).toHaveBeenCalledTimes(1);
    const calledWith = vi.mocked(generateContentPlan).mock.calls[0]?.[0];
    expect(calledWith).toEqual(expect.arrayContaining(["reel", "carousel"]));
    expect(calledWith).toHaveLength(2);

    // Panel closes after a successful generate.
    expect(
      screen.queryByRole("button", { name: "Post" }),
    ).not.toBeInTheDocument();
  });

  it("calls generateContentPlan with undefined when nothing is selected", async () => {
    const user = userEvent.setup();
    renderButton();
    await openPicker(user);

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(generateContentPlan).toHaveBeenCalledWith(undefined);
  });

  it("surfaces an error toast and keeps the panel open when the api call rejects", async () => {
    vi.mocked(generateContentPlan).mockRejectedValueOnce(
      new Error("Something broke"),
    );
    const user = userEvent.setup();
    renderButton();
    await openPicker(user);

    await user.click(screen.getByRole("button", { name: "Generate" }));

    // The toast region (aria-live="assertive") should contain the error message.
    expect(await screen.findByText("Something broke")).toBeInTheDocument();

    // Panel stays open after a failure.
    expect(screen.getByRole("button", { name: "Post" })).toBeInTheDocument();
  });
});
