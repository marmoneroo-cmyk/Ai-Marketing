"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PlatformBadge } from "@/components/platform-badge";
import { useToast } from "@/components/ui/toast";
import { decideApproval, decideApprovals } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/cn";
import { IconCheck } from "@/components/icons";
import type { ApprovalKind, PendingApproval } from "@/lib/types";

type Decision = "approve" | "reject";

interface ApprovalsPanelProps {
  approvals: PendingApproval[];
}

const KIND_TONE: Record<ApprovalKind, "brand" | "info" | "warning"> = {
  content: "brand",
  publish: "info",
  quote: "warning",
};

const KIND_LABEL: Record<ApprovalKind, string> = {
  content: "Content",
  publish: "Publish",
  quote: "Quote",
};

/** Flip a decision to its opposite — used when undoing a bulk decision. */
function opposite(decision: Decision): Decision {
  return decision === "approve" ? "reject" : "approve";
}

export function ApprovalsPanel({ approvals }: ApprovalsPanelProps) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [pending, setPending] = useState<{ id: string; decision: Decision } | null>(
    null,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchPending, setBatchPending] = useState<Decision | null>(null);
  const { notify } = useToast();

  async function handleDecide(id: string, decision: Decision) {
    setPending({ id, decision });
    try {
      await decideApproval(id, decision);
      // Confirm the decision only AFTER the server accepts it — a consequential
      // action (publish/spend) must never show "Approved" before it is saved,
      // and must not flicker approved→buttons on failure.
      setDecisions((prev) => ({ ...prev, [id]: decision }));
      notify(decision === "approve" ? "Approved." : "Rejected.", "success");
    } catch (error: unknown) {
      notify(
        error instanceof Error
          ? error.message
          : "Couldn't save your decision. Please try again.",
        "error",
      );
    } finally {
      setPending(null);
    }
  }

  const openApprovals = approvals.filter((a) => !decisions[a.id]);
  const openCount = openApprovals.length;
  // Recomputed from `openApprovals` (not raw `selected.size`) so a row that
  // gets individually decided out from under a stale selection never inflates
  // the bulk bar's count.
  const selectedOpenIds = openApprovals.filter((a) => selected.has(a.id)).map((a) => a.id);
  const selectedCount = selectedOpenIds.length;
  const allOpenSelected = openCount > 0 && selectedCount === openCount;

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allOpenSelected ? new Set() : new Set(openApprovals.map((a) => a.id)));
  }

  /**
   * Undo a just-completed bulk decision. Best-effort: this re-calls the same
   * batch endpoint with the opposite decision, which only actually reverses a
   * row the server still considers pending — see `decideApprovals`/`POST
   * /approvals/batch`. Approvals are scheduled, not executed instantly, so
   * there's normally a real grace window before anything downstream (e.g. the
   * publish tick) has consumed the decision; once that window has passed this
   * is a no-op server-side. Either way the rows are restored to "open" in the
   * UI immediately so the human can re-review and re-decide them.
   */
  async function handleUndo(ids: string[], decidedAs: Decision) {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
    try {
      await decideApprovals(ids, opposite(decidedAs));
    } catch (error: unknown) {
      notify(
        error instanceof Error ? error.message : "Couldn't undo. Please try again.",
        "error",
      );
    }
  }

  /**
   * Bulk approve/reject the selected rows. Unlike the single-row path (which
   * waits for the server before showing ANY confirmation, since a
   * consequential action must never flicker), the bulk path marks rows
   * decided as soon as the batch call resolves and relies on the Undo toast
   * as its safety net — an acceptable tradeoff at N-row scale that the
   * single-row path deliberately does not make.
   */
  async function handleBatchDecide(decision: Decision) {
    const ids = selectedOpenIds;
    if (ids.length === 0) return;

    setBatchPending(decision);
    try {
      const { decided } = await decideApprovals(ids, decision);

      if (decided.length > 0) {
        setDecisions((prev) => {
          const next = { ...prev };
          for (const id of decided) next[id] = decision;
          return next;
        });
      }
      setSelected(new Set());

      const verb = decision === "approve" ? "approved" : "rejected";
      if (decided.length > 0) {
        notify(`${decided.length} ${verb}.`, "success", {
          label: "Undo",
          onClick: () => {
            void handleUndo(decided, decision);
          },
        });
      }

      // Never silently pretend a skipped id succeeded — e.g. another reviewer
      // already decided it in the meantime.
      const skipped = ids.length - decided.length;
      if (skipped > 0) {
        notify(
          `${skipped} item${skipped === 1 ? "" : "s"} could not be ${verb} — already decided.`,
          "error",
        );
      }
    } catch (error: unknown) {
      notify(
        error instanceof Error
          ? error.message
          : "Couldn't save your decisions. Please try again.",
        "error",
      );
    } finally {
      setBatchPending(null);
    }
  }

  if (approvals.length === 0) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            Pending approvals
          </h3>
          <Badge tone="success">All clear</Badge>
        </CardHeader>
        <div className="flex flex-col items-center gap-2 px-5 pb-8 pt-2 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
            <IconCheck className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium text-foreground">
            You&apos;re all caught up
          </p>
          <p className="max-w-xs text-sm text-muted">
            Nothing needs your approval right now. BrandPilot will surface items
            here as they come up.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            Pending approvals
          </h3>
          <Badge tone={openCount > 0 ? "warning" : "success"}>
            {openCount > 0 ? `${openCount} awaiting you` : "All clear"}
          </Badge>
        </div>
      </CardHeader>

      {openCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-2.5">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={allOpenSelected}
              onChange={toggleSelectAll}
              disabled={batchPending !== null}
              className="h-4 w-4 cursor-pointer accent-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed"
            />
            Select all
          </label>
          {selectedCount > 0 ? (
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="success"
                disabled={batchPending !== null}
                onClick={() => handleBatchDecide("approve")}
              >
                {batchPending === "approve" ? "Approving…" : `Approve ${selectedCount}`}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={batchPending !== null}
                onClick={() => handleBatchDecide("reject")}
              >
                {batchPending === "reject" ? "Rejecting…" : `Reject ${selectedCount}`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <ul className="stagger divide-y divide-border">
        {approvals.map((item) => {
          const decided = decisions[item.id];
          const isPending = pending?.id === item.id;
          return (
            <li key={item.id} className="interactive-row px-5 py-4 hover:bg-surface-muted/60">
              <div className="flex flex-wrap items-center gap-2">
                {!decided ? (
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelected(item.id)}
                    disabled={batchPending !== null}
                    aria-label={`Select ${item.title}`}
                    className="h-4 w-4 cursor-pointer accent-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed"
                  />
                ) : null}
                <Badge tone={KIND_TONE[item.kind]}>{KIND_LABEL[item.kind]}</Badge>
                {item.platform ? <PlatformBadge platform={item.platform} /> : null}
                {typeof item.value === "number" ? (
                  <Badge tone="neutral">{formatCurrency(item.value)}</Badge>
                ) : null}
                <span className="ml-auto text-xs font-medium text-subtle">
                  {item.confidence}% confidence
                </span>
              </div>

              <p className="mt-2 text-sm font-medium text-foreground">
                {item.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {item.summary}
              </p>

              <div className="mt-3">
                {decided ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-sm font-medium",
                      decided === "approve"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-subtle",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        decided === "approve" ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600",
                      )}
                    />
                    {decided === "approve" ? "Approved" : "Rejected"}
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="success"
                      disabled={isPending}
                      onClick={() => handleDecide(item.id, "approve")}
                    >
                      {isPending && pending?.decision === "approve"
                        ? "Approving…"
                        : "Approve"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={isPending}
                      onClick={() => handleDecide(item.id, "reject")}
                    >
                      {isPending && pending?.decision === "reject"
                        ? "Rejecting…"
                        : "Reject"}
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
