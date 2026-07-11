"use client";

import { useState } from "react";
import { resendVerification } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

/**
 * Dismissible banner shown at the top of the dashboard when the signed-in
 * user's email isn't confirmed yet. Dismissal is local/session-only (no
 * persistence) — it reappears on next visit until the org profile reports
 * `emailVerified: true`.
 */
export function VerifyEmailBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const { notify } = useToast();

  if (dismissed) return null;

  async function handleResend() {
    if (sending) return;
    setSending(true);
    try {
      await resendVerification();
      notify("Verification email sent.", "success");
    } catch (error: unknown) {
      notify(
        error instanceof Error ? error.message : "Couldn't resend the verification email.",
        "error",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted/60 px-4 py-3 text-sm text-foreground"
    >
      <span>Please verify your email to secure your account.</span>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={sending}
          className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-brand-600 transition-colors duration-150 ease-out hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:text-brand-fg"
        >
          {sending ? "Sending…" : "Resend email"}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
