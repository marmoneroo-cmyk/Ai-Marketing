"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { decideApproval, scheduleVariant } from "@/lib/api";
import { cn } from "@/lib/cn";

type Decision = "approve" | "reject";

interface VariantReviewActionsProps {
  /**
   * The related approval row id for this variant's content item. When null, no
   * approval exists yet so the actions are disabled with an explanatory note.
   */
  approvalId: string | null;
  /** Platform label, used only to make the button aria-labels descriptive. */
  platformLabel: string;
  /** The variant's id, used to schedule it for auto-publishing. */
  variantId: string;
  /**
   * Whether this variant is eligible to be scheduled (approved). When false the
   * Schedule control is not rendered.
   */
  canSchedule: boolean;
}

/** Matches the API's friendly "no connected account" message. */
const NO_ACCOUNT_HINT =
  "No channel connected for this platform. Connect one in Settings to schedule.";

/**
 * Native datetime-local + Schedule button for an approved variant. Calls
 * `scheduleVariant`; on success the control collapses to a confirmation, and on
 * failure it toasts the error (pointing to Settings when no channel is
 * connected). Kept alongside the review actions so the Content page stays a
 * server component and each variant row owns its own scheduling state.
 */
function VariantScheduleControl({
  variantId,
  platformLabel,
}: {
  variantId: string;
  platformLabel: string;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const { notify } = useToast();
  const inputId = useId();

  async function handleSchedule() {
    if (!value || pending) return;
    setPending(true);
    try {
      // datetime-local yields a local wall-clock string; convert to ISO (UTC).
      const iso = new Date(value).toISOString();
      await scheduleVariant(variantId, iso);
      setScheduled(true);
      notify("Scheduled for publishing.", "success");
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Couldn't schedule this post. Please try again.";
      notify(
        /no connected account/i.test(message) ? NO_ACCOUNT_HINT : message,
        "error",
      );
    } finally {
      setPending(false);
    }
  }

  if (scheduled) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400"
        role="status"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
        Scheduled
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={inputId} className="sr-only">
        Schedule {platformLabel} variant for
      </label>
      <input
        id={inputId}
        type="datetime-local"
        value={value}
        disabled={pending}
        onChange={(event) => setValue(event.target.value)}
        className={cn(
          "h-8 rounded-xl border border-border bg-surface px-2.5 text-xs text-foreground shadow-sm outline-none transition-colors",
          "focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || !value}
        aria-label={`Schedule ${platformLabel} variant`}
        onClick={() => void handleSchedule()}
      >
        {pending ? "Scheduling…" : "Schedule"}
      </Button>
    </div>
  );
}

/**
 * Per-variant Approve / Reject controls for the content review surface. Mirrors
 * the optimistic-update + rollback + toast pattern in `ApprovalsPanel`: the
 * decision is reflected immediately, confirmed against the API, and rolled back
 * with an error toast on failure. Kept as a small client island so the Content
 * page itself stays a server component.
 */
export function VariantReviewActions({
  approvalId,
  platformLabel,
  variantId,
  canSchedule,
}: VariantReviewActionsProps) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null);
  const { notify } = useToast();

  async function handleDecide(next: Decision) {
    if (!approvalId || pendingDecision) return;
    setPendingDecision(next);
    try {
      await decideApproval(approvalId, next);
      // Confirm only AFTER the server accepts — a consequential action (content
      // going live) must not show "Approved" before it's saved, nor flicker
      // approved→buttons on failure.
      setDecision(next);
      notify(next === "approve" ? "Approved." : "Rejected.", "success");
    } catch (error: unknown) {
      notify(
        error instanceof Error
          ? error.message
          : "Couldn't save your decision. Please try again.",
        "error",
      );
    } finally {
      setPendingDecision(null);
    }
  }

  // An approved variant (already approved on the server, or just approved in
  // this session) can be scheduled for auto-publishing.
  const showSchedule = canSchedule || decision === "approve";

  if (!approvalId) {
    return (
      <span className="text-xs text-subtle" role="note">
        Not ready for review
      </span>
    );
  }

  if (decision) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium",
            decision === "approve"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-subtle",
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              decision === "approve"
                ? "bg-emerald-500"
                : "bg-zinc-300 dark:bg-zinc-600",
            )}
            aria-hidden="true"
          />
          {decision === "approve" ? "Approved" : "Rejected"}
        </span>
        {showSchedule ? (
          <VariantScheduleControl
            variantId={variantId}
            platformLabel={platformLabel}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="success"
          disabled={pendingDecision !== null}
          aria-label={`Approve ${platformLabel} variant`}
          onClick={() => void handleDecide("approve")}
        >
          {pendingDecision === "approve" ? "Approving…" : "Approve"}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={pendingDecision !== null}
          aria-label={`Reject ${platformLabel} variant`}
          onClick={() => void handleDecide("reject")}
        >
          {pendingDecision === "reject" ? "Rejecting…" : "Reject"}
        </Button>
      </div>
      {showSchedule ? (
        <VariantScheduleControl
          variantId={variantId}
          platformLabel={platformLabel}
        />
      ) : null}
    </div>
  );
}
