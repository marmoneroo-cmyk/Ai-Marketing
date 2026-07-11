import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VariantCaption } from "./VariantCaption";
import { ToastProvider } from "@/components/ui/toast";
import { updateVariant } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  updateVariant: vi.fn(),
}));

const VARIANT_ID = "variant-1";
const INITIAL_CAPTION = "Original caption text";
const PLATFORM_LABEL = "Instagram";

const EDIT_LABEL = `Edit ${PLATFORM_LABEL} caption`;
const SAVE_LABEL = `Save ${PLATFORM_LABEL} caption`;
const CANCEL_LABEL = `Cancel editing ${PLATFORM_LABEL} caption`;

function renderCaption(
  props: Partial<{ initialCaption: string; fallback: string; platformLabel: string }> = {},
) {
  return render(
    <ToastProvider>
      <VariantCaption
        variantId={VARIANT_ID}
        initialCaption={props.initialCaption ?? INITIAL_CAPTION}
        fallback={props.fallback}
        platformLabel={props.platformLabel ?? PLATFORM_LABEL}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.mocked(updateVariant).mockReset();
  vi.mocked(updateVariant).mockResolvedValue({
    id: VARIANT_ID,
    caption: INITIAL_CAPTION,
    hashtags: [],
  });
});

describe("VariantCaption", () => {
  it("clicking Edit swaps in a textarea pre-filled with the caption", async () => {
    const user = userEvent.setup();
    renderCaption();

    expect(screen.getByText(INITIAL_CAPTION)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: EDIT_LABEL }));

    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue(INITIAL_CAPTION);
  });

  it("typing and Save calls updateVariant and renders the updated text", async () => {
    const updatedCaption = "A brand new caption";
    vi.mocked(updateVariant).mockResolvedValue({
      id: VARIANT_ID,
      caption: updatedCaption,
      hashtags: [],
    });

    const user = userEvent.setup();
    renderCaption();

    await user.click(screen.getByRole("button", { name: EDIT_LABEL }));
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, updatedCaption);

    await user.click(screen.getByRole("button", { name: SAVE_LABEL }));

    expect(updateVariant).toHaveBeenCalledWith(VARIANT_ID, {
      caption: updatedCaption,
    });
    expect(await screen.findByText(updatedCaption)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("saving an empty caption shows an error toast and does not call the api", async () => {
    const user = userEvent.setup();
    renderCaption();

    await user.click(screen.getByRole("button", { name: EDIT_LABEL }));
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);

    await user.click(screen.getByRole("button", { name: SAVE_LABEL }));

    expect(await screen.findByText("Caption can't be empty.")).toBeInTheDocument();
    expect(updateVariant).not.toHaveBeenCalled();
    // Still editing — the textarea remains.
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("Cancel restores the display without calling the api", async () => {
    const user = userEvent.setup();
    renderCaption();

    await user.click(screen.getByRole("button", { name: EDIT_LABEL }));
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "Some throwaway edit");

    await user.click(screen.getByRole("button", { name: CANCEL_LABEL }));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(INITIAL_CAPTION)).toBeInTheDocument();
    expect(updateVariant).not.toHaveBeenCalled();
  });

  it("does not show a character counter below the 4,000 character threshold", async () => {
    const user = userEvent.setup();
    renderCaption();

    await user.click(screen.getByRole("button", { name: EDIT_LABEL }));
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    // paste avoids per-keystroke typing for a large string in the test.
    await user.paste("a".repeat(4000));

    expect(textarea).toHaveValue("a".repeat(4000));
    expect(screen.queryByText(/4,000 \/ 5,000/)).not.toBeInTheDocument();
  });

  it("shows a character counter once content passes 4,000 characters", async () => {
    const user = userEvent.setup();
    renderCaption();

    await user.click(screen.getByRole("button", { name: EDIT_LABEL }));
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.paste("a".repeat(4001));

    expect(textarea).toHaveValue("a".repeat(4001));
    expect(screen.getByText("4,001 / 5,000")).toBeInTheDocument();
  });

  it("interpolates the given platform label into the edit, save, and cancel accessible names", async () => {
    const user = userEvent.setup();
    renderCaption({ platformLabel: "TikTok" });

    expect(
      screen.getByRole("button", { name: "Edit TikTok caption" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit TikTok caption" }));

    expect(
      screen.getByRole("button", { name: "Save TikTok caption" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel editing TikTok caption" }),
    ).toBeInTheDocument();
  });
});
