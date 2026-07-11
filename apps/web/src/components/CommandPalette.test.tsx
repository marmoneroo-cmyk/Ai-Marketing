import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./CommandPalette";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  push.mockReset();
});

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}k{/Control}");
}

function getDialog() {
  return screen.getByRole("dialog", { name: "Command menu" });
}

function queryDialog() {
  return screen.queryByRole("dialog", { name: "Command menu" });
}

function getInput() {
  return screen.getByRole("combobox", { name: "Search commands" });
}

describe("CommandPalette", () => {
  it("is closed until Ctrl+K (or Cmd+K) is pressed, then opens with focus in the search input", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    expect(queryDialog()).not.toBeInTheDocument();

    await openPalette(user);

    expect(getDialog()).toBeInTheDocument();
    expect(getInput()).toHaveFocus();
  });

  it("also opens on Cmd+K (metaKey)", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard("{Meta>}k{/Meta}");

    expect(getDialog()).toBeInTheDocument();
  });

  it("lists every sidebar destination as a 'Go to <page>' command by default", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette(user);

    expect(screen.getByRole("option", { name: /Go to Dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Go to Approvals/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Go to Analytics/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Invite a member/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Review approvals/ })).toBeInTheDocument();
  });

  it("filters the options as the user types (case-insensitive substring)", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette(user);

    await user.type(getInput(), "ANALY");

    expect(screen.getByRole("option", { name: /Go to Analytics/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Go to Dashboard/ })).not.toBeInTheDocument();
  });

  it("shows a 'No commands' message when nothing matches", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette(user);

    await user.type(getInput(), "xyz-nonexistent");

    expect(screen.getByText(/no commands/i)).toBeInTheDocument();
  });

  it("pressing Enter on the highlighted option navigates and closes the dialog", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette(user);

    await user.type(getInput(), "analytics");
    await user.keyboard("{Enter}");

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/analytics");
    expect(queryDialog()).not.toBeInTheDocument();
  });

  it("Down/Up arrows move the highlighted option with wrap-around", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette(user);

    const input = getInput();
    const first = screen.getByRole("option", { name: /Go to Dashboard/ });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", first.id);

    await user.type(input, "{ArrowUp}");
    const last = screen.getByRole("option", { name: /Review approvals/ });
    expect(last).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", last.id);

    await user.type(input, "{ArrowDown}");
    expect(first).toHaveAttribute("aria-selected", "true");
  });

  it("traps Tab within the dialog instead of moving focus to elements outside it", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Opener</button>
        <CommandPalette />
      </div>,
    );

    await openPalette(user);
    const input = getInput();
    expect(input).toHaveFocus();

    // The input is the only focusable element inside the dialog, so both
    // Tab and Shift+Tab should cycle back to it rather than escaping to the
    // "Opener" button (or the backdrop's close button) outside the trap.
    await user.tab();
    expect(input).toHaveFocus();

    await user.tab({ shift: true });
    expect(input).toHaveFocus();
  });

  it("closes on Escape and restores focus to the element that opened it", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Opener</button>
        <CommandPalette />
      </div>,
    );

    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    expect(opener).toHaveFocus();

    await openPalette(user);
    expect(getDialog()).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(queryDialog()).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("clicking a result navigates and closes the dialog", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette(user);

    await user.click(screen.getByRole("option", { name: /Go to Approvals/ }));

    expect(push).toHaveBeenCalledWith("/approvals");
    expect(queryDialog()).not.toBeInTheDocument();
  });

  it("clicking the backdrop closes without navigating", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette(user);

    await user.click(screen.getByRole("button", { name: "Close command menu" }));

    expect(queryDialog()).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
