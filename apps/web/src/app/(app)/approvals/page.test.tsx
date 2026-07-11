import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/toast";
import ApprovalsPage from "./page";
import { getApprovals } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import type { PendingApproval } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getApprovals: vi.fn(),
  decideApproval: vi.fn(),
}));

const APPROVALS: PendingApproval[] = [
  {
    id: "apr_t1",
    kind: "content",
    title: "Reel: test content approval",
    summary: "A content approval summary.",
    platform: "instagram",
    confidence: 90,
    createdAt: "2026-07-11T08:00:00Z",
  },
  {
    id: "apr_t2",
    kind: "quote",
    title: "Quote for Test Co. — package",
    summary: "A quote approval summary.",
    value: 1800,
    confidence: 77,
    createdAt: "2026-07-11T07:00:00Z",
  },
];

/** Await the async server component, then render its resolved element tree. */
async function renderApprovalsPage() {
  const ui = await ApprovalsPage();
  return render(<ToastProvider>{ui}</ToastProvider>);
}

beforeEach(() => {
  vi.mocked(getApprovals).mockReset();
});

describe("ApprovalsPage", () => {
  it("renders each approval's type, summary, quote value badge, and decide controls", async () => {
    vi.mocked(getApprovals).mockResolvedValue(APPROVALS);

    await renderApprovalsPage();

    expect(
      screen.getByRole("heading", { name: "Approvals" }),
    ).toBeInTheDocument();

    expect(screen.getByText("Reel: test content approval")).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();

    expect(
      screen.getByText("Quote for Test Co. — package"),
    ).toBeInTheDocument();
    expect(screen.getByText("Quote")).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(1800))).toBeInTheDocument();

    // Every item exposes Approve/Reject decide controls (the same ones
    // ApprovalsPanel wires to decideApproval on the dashboard).
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(2);
  });

  it("shows the empty state when there are no approvals", async () => {
    vi.mocked(getApprovals).mockResolvedValue([]);

    await renderApprovalsPage();

    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
  });
});
