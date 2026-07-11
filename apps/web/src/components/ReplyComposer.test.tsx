import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReplyComposer } from "./ReplyComposer";
import { ToastProvider } from "@/components/ui/toast";
import { sendReply } from "@/lib/api";
import type { ConversationMessage } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  sendReply: vi.fn(),
}));

function renderComposer(onSent = vi.fn()) {
  render(
    <ToastProvider>
      <ReplyComposer conversationId="cnv_01" onSent={onSent} />
    </ToastProvider>,
  );
  return { onSent };
}

const REPLY: ConversationMessage = {
  id: "msg_new",
  direction: "outbound",
  author: "human",
  body: "Sounds good!",
  createdAt: "2026-07-11T10:00:00Z",
};

beforeEach(() => {
  vi.mocked(sendReply).mockReset();
});

describe("ReplyComposer", () => {
  it("renders a labeled textarea and a disabled Send reply button when empty", () => {
    renderComposer();

    expect(screen.getByLabelText("Reply as yourself")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Send reply" });
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it("enables Send reply once text is typed, and calls sendReply with the trimmed body", async () => {
    vi.mocked(sendReply).mockResolvedValueOnce(REPLY);
    const onSent = vi.fn();
    renderComposer(onSent);
    const user = userEvent.setup();

    const textarea = screen.getByLabelText("Reply as yourself");
    await user.type(textarea, "  Sounds good!  ");
    const button = screen.getByRole("button", { name: "Send reply" });
    expect(button).toBeEnabled();

    await user.click(button);

    expect(sendReply).toHaveBeenCalledWith("cnv_01", "Sounds good!");
    expect(onSent).toHaveBeenCalledWith(REPLY);
  });

  it("clears the textarea after a successful send", async () => {
    vi.mocked(sendReply).mockResolvedValueOnce(REPLY);
    renderComposer();
    const user = userEvent.setup();

    const textarea = screen.getByLabelText("Reply as yourself");
    await user.type(textarea, "Sounds good!");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    expect(await screen.findByRole("button", { name: "Send reply" })).toBeDisabled();
    expect(textarea).toHaveValue("");
  });

  it("shows a busy 'Sending…' state and disables the textarea while the request is pending", async () => {
    let resolveSend: (message: ConversationMessage) => void = () => {};
    vi.mocked(sendReply).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );
    renderComposer();
    const user = userEvent.setup();

    const textarea = screen.getByLabelText("Reply as yourself");
    await user.type(textarea, "Hang on a sec");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    expect(screen.getByRole("button", { name: "Sending…" })).toBeInTheDocument();
    expect(textarea).toBeDisabled();
    expect(textarea).toHaveAttribute("aria-busy", "true");

    resolveSend(REPLY);
    await screen.findByRole("button", { name: "Send reply" });
  });

  it("shows an error toast and preserves the drafted text when the request fails", async () => {
    vi.mocked(sendReply).mockRejectedValueOnce(new Error("Network down"));
    renderComposer();
    const user = userEvent.setup();

    const textarea = screen.getByLabelText("Reply as yourself");
    await user.type(textarea, "Trying again");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    expect(await screen.findByText("Network down")).toBeInTheDocument();
    expect(textarea).toHaveValue("Trying again");
  });

  it("sends on Enter and inserts a newline on Shift+Enter", async () => {
    vi.mocked(sendReply).mockResolvedValue(REPLY);
    renderComposer();
    const user = userEvent.setup();

    const textarea = screen.getByLabelText("Reply as yourself");
    await user.type(textarea, "Line one{Shift>}{Enter}{/Shift}Line two");
    expect(textarea).toHaveValue("Line one\nLine two");

    await user.type(textarea, "{Enter}");
    expect(sendReply).toHaveBeenCalledWith("cnv_01", "Line one\nLine two");
  });

  it("does not call sendReply for a whitespace-only body", async () => {
    renderComposer();
    const user = userEvent.setup();

    const textarea = screen.getByLabelText("Reply as yourself");
    await user.type(textarea, "   ");

    expect(screen.getByRole("button", { name: "Send reply" })).toBeDisabled();
    expect(sendReply).not.toHaveBeenCalled();
  });
});
