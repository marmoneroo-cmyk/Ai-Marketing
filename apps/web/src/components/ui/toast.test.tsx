import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "./toast";

/** Exercises `notify` via real button clicks, mirroring how a consumer calls it. */
function Harness({ onUndo }: { onUndo: () => void }) {
  const { notify } = useToast();
  return (
    <div>
      <button onClick={() => notify("Saved.")}>fire-1arg</button>
      <button onClick={() => notify("Saved with tone.", "error")}>fire-2arg</button>
      <button
        onClick={() =>
          notify("3 approved.", "success", { label: "Undo", onClick: onUndo })
        }
      >
        fire-with-action
      </button>
    </div>
  );
}

function renderHarness(onUndo: () => void = vi.fn()) {
  render(
    <ToastProvider>
      <Harness onUndo={onUndo} />
    </ToastProvider>,
  );
}

describe("toast.tsx — notify's optional action", () => {
  it("still works with a single argument (message only)", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "fire-1arg" }));

    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("still works with the existing 2-arg (message, tone) call — no action button rendered", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "fire-2arg" }));

    expect(await screen.findByText("Saved with tone.")).toBeInTheDocument();
    // Only the dismiss ("X") control exists — no extra labeled action button.
    expect(screen.queryByText("Undo")).not.toBeInTheDocument();
  });

  it("renders a real, accessible button for a 3rd-arg action, and clicking it fires onClick then dismisses the toast", async () => {
    const onUndo = vi.fn();
    const user = userEvent.setup();
    renderHarness(onUndo);

    await user.click(screen.getByRole("button", { name: "fire-with-action" }));
    expect(await screen.findByText("3 approved.")).toBeInTheDocument();

    const undoButton = screen.getByRole("button", { name: "Undo" });
    expect(undoButton.tagName).toBe("BUTTON");

    await user.click(undoButton);

    expect(onUndo).toHaveBeenCalledTimes(1);
    // Clicking the action also dismisses its toast.
    expect(screen.queryByText("3 approved.")).not.toBeInTheDocument();
  });

  it("the action button is keyboard-reachable via Tab and activatable via Enter", async () => {
    const onUndo = vi.fn();
    const user = userEvent.setup();
    renderHarness(onUndo);

    await user.click(screen.getByRole("button", { name: "fire-with-action" }));
    await screen.findByText("3 approved.");

    const undoButton = screen.getByRole("button", { name: "Undo" });
    undoButton.focus();
    expect(undoButton).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
