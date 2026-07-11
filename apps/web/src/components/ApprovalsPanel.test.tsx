import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/toast";
import { ApprovalsPanel } from "./ApprovalsPanel";
import { decideApproval, decideApprovals } from "@/lib/api";
import type { PendingApproval } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  decideApproval: vi.fn(),
  decideApprovals: vi.fn(),
}));

const APPROVALS: PendingApproval[] = [
  {
    id: "apr_1",
    kind: "content",
    title: "Reel: 5-minute morning routine",
    summary: "A content approval summary.",
    platform: "instagram",
    confidence: 90,
    createdAt: "2026-07-11T08:00:00Z",
  },
  {
    id: "apr_2",
    kind: "quote",
    title: "Quote for Acme Co. — laser package",
    summary: "A quote approval summary.",
    value: 1200,
    confidence: 77,
    createdAt: "2026-07-11T07:00:00Z",
  },
];

function renderPanel(approvals: PendingApproval[] = APPROVALS) {
  return render(
    <ToastProvider>
      <ApprovalsPanel approvals={approvals} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.mocked(decideApproval).mockReset();
  vi.mocked(decideApprovals).mockReset();
});

describe("ApprovalsPanel — single-row decide (unchanged pessimistic-confirm path)", () => {
  it("still calls decideApproval for a single row and only shows the decided label after the server accepts it", async () => {
    let resolveDecide: () => void = () => {};
    vi.mocked(decideApproval).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDecide = () => resolve(undefined);
      }),
    );
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getAllByRole("button", { name: "Approve" })[0]!);

    // Pessimistic: still showing the busy label, not yet "Approved".
    expect(screen.getByRole("button", { name: "Approving…" })).toBeInTheDocument();
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();

    resolveDecide();
    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(decideApproval).toHaveBeenCalledWith("apr_1", "approve");
  });
});

describe("ApprovalsPanel — bulk selection", () => {
  it("shows no batch bar until at least one row is selected", () => {
    renderPanel();

    expect(screen.queryByRole("button", { name: /^Approve \d/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reject \d/ })).not.toBeInTheDocument();
  });

  it("every open row's checkbox is individually labeled, and the select-all checkbox is labeled", () => {
    renderPanel();

    expect(
      screen.getByRole("checkbox", { name: `Select ${APPROVALS[0]!.title}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: `Select ${APPROVALS[1]!.title}` }),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select all" })).toBeInTheDocument();
  });

  it("selecting a single row's checkbox shows a batch bar scoped to that one row", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("checkbox", { name: `Select ${APPROVALS[0]!.title}` }));

    expect(screen.getByRole("button", { name: "Approve 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject 1" })).toBeInTheDocument();
  });

  it("select-all checks every open row and batch-approves all of them, showing an Undo toast", async () => {
    const user = userEvent.setup();
    vi.mocked(decideApprovals).mockResolvedValue({ decided: ["apr_1", "apr_2"] });
    renderPanel();

    await user.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByRole("button", { name: "Approve 2" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve 2" }));

    expect(decideApprovals).toHaveBeenCalledWith(["apr_1", "apr_2"], "approve");
    expect(await screen.findByText("2 approved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    // Both rows now render the same decided label the single-row path uses.
    expect(screen.getAllByText("Approved")).toHaveLength(2);
    // The batch bar disappears once nothing is left open/selected.
    expect(screen.queryByRole("checkbox", { name: "Select all" })).not.toBeInTheDocument();
  });

  it("clicking Undo re-calls decideApprovals with the opposite decision and restores the rows", async () => {
    const user = userEvent.setup();
    vi.mocked(decideApprovals).mockResolvedValueOnce({ decided: ["apr_1", "apr_2"] });
    renderPanel();

    await user.click(screen.getByRole("checkbox", { name: "Select all" }));
    await user.click(screen.getByRole("button", { name: "Approve 2" }));
    const undoButton = await screen.findByRole("button", { name: "Undo" });

    vi.mocked(decideApprovals).mockResolvedValueOnce({ decided: ["apr_1", "apr_2"] });
    await user.click(undoButton);

    expect(decideApprovals).toHaveBeenNthCalledWith(2, ["apr_1", "apr_2"], "reject");
    // The rows are restored to their pre-decision Approve/Reject controls.
    expect(await screen.findAllByRole("button", { name: "Approve" })).toHaveLength(2);
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
  });

  it("surfaces an error (never a silent success) for ids the server skipped, e.g. already decided elsewhere", async () => {
    const user = userEvent.setup();
    // Only apr_1 actually transitioned; apr_2 was skipped server-side.
    vi.mocked(decideApprovals).mockResolvedValue({ decided: ["apr_1"] });
    renderPanel();

    await user.click(screen.getByRole("checkbox", { name: "Select all" }));
    await user.click(screen.getByRole("button", { name: "Approve 2" }));

    expect(await screen.findByText("1 approved.")).toBeInTheDocument();
    expect(
      await screen.findByText("1 item could not be approved — already decided."),
    ).toBeInTheDocument();
    // Only the truly-decided row shows the label; the skipped one keeps its controls.
    expect(screen.getAllByText("Approved")).toHaveLength(1);
  });

  it("surfaces the error toast and leaves rows untouched when the batch call itself rejects", async () => {
    const user = userEvent.setup();
    vi.mocked(decideApprovals).mockRejectedValueOnce(new Error("Network unreachable"));
    renderPanel();

    await user.click(screen.getByRole("checkbox", { name: "Select all" }));
    await user.click(screen.getByRole("button", { name: "Approve 2" }));

    expect(await screen.findByText("Network unreachable")).toBeInTheDocument();
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
  });
});
