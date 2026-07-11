import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversationThread } from "./ConversationThread";
import { ToastProvider } from "@/components/ui/toast";
import { sendReply } from "@/lib/api";
import type { ConversationMessage } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  sendReply: vi.fn(),
}));

const SEED_MESSAGES: ConversationMessage[] = [
  {
    id: "msg_01",
    direction: "inbound",
    author: "customer",
    body: "Do you have Saturday openings?",
    createdAt: "2026-07-08T09:02:00Z",
  },
];

function renderThread(status: string, initialMessages = SEED_MESSAGES) {
  return render(
    <ToastProvider>
      <ConversationThread
        conversationId="cnv_01"
        status={status}
        initialMessages={initialMessages}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.mocked(sendReply).mockReset();
});

describe("ConversationThread", () => {
  it("renders seeded messages and the reply composer for a needs_human conversation", () => {
    renderThread("needs_human");

    expect(
      screen.getByText("Do you have Saturday openings?"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send reply" }),
    ).toBeInTheDocument();
  });

  it("renders the composer for an open conversation", () => {
    renderThread("open");

    expect(
      screen.getByRole("button", { name: "Send reply" }),
    ).toBeInTheDocument();
  });

  it("hides the composer for a closed conversation", () => {
    renderThread("closed");

    expect(
      screen.queryByRole("button", { name: "Send reply" }),
    ).not.toBeInTheDocument();
  });

  it("hides the composer for an ai_handling conversation", () => {
    renderThread("ai_handling");

    expect(
      screen.queryByRole("button", { name: "Send reply" }),
    ).not.toBeInTheDocument();
  });

  it("shows the empty-thread message when there are no seed messages, and still shows the composer", () => {
    renderThread("needs_human", []);

    expect(
      screen.getByText("No messages in this thread yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send reply" }),
    ).toBeInTheDocument();
  });

  it("appends the sent message to the thread on success, alongside the original seed message", async () => {
    const reply: ConversationMessage = {
      id: "msg_new",
      direction: "outbound",
      author: "human",
      body: "Yes, 2:30pm works!",
      createdAt: "2026-07-11T10:05:00Z",
    };
    vi.mocked(sendReply).mockResolvedValueOnce(reply);
    renderThread("needs_human");
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText("Reply as yourself"),
      "Yes, 2:30pm works!",
    );
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    expect(await screen.findByText("Yes, 2:30pm works!")).toBeInTheDocument();
    expect(
      screen.getByText("Do you have Saturday openings?"),
    ).toBeInTheDocument();
  });

  it("blocks sending an empty body — sendReply is never called and no message is appended", async () => {
    renderThread("needs_human");

    expect(screen.getByRole("button", { name: "Send reply" })).toBeDisabled();
    expect(sendReply).not.toHaveBeenCalled();
    // Only the single seeded message is present — nothing was appended.
    expect(screen.getByText("Do you have Saturday openings?")).toBeInTheDocument();
    expect(screen.queryByText("No messages in this thread yet.")).not.toBeInTheDocument();
  });
});
