"use client";

import { useState } from "react";
import { hasOAuthStart, startConnect } from "@/lib/api";
import type { Platform } from "@/lib/types";
import { cn } from "@/lib/cn";
import { PLATFORM_DOT_COLOR } from "@/lib/platform";

interface SocialConnectButtonProps {
  provider: Platform;
  label: string;
  /** Optional supporting copy (card variant only). */
  hint?: string;
  /** "pill" = compact chip (login hero); "card" = full onboarding card. */
  variant?: "pill" | "card";
  /** Visual theme for the pill variant. */
  surface?: "light" | "dark";
  /**
   * When true, renders a non-actionable "Connected" state (check icon +
   * "Connected", matching `ChannelRow`'s connected vocab in Settings) instead
   * of the Connect CTA. The button is disabled/inert — clicking never starts
   * OAuth. Defaults to false, so existing login/settings callers that don't
   * pass it are unaffected.
   */
  connected?: boolean;
}

type ConnectStatus = "idle" | "connecting" | "error";

/** Small inline checkmark, styled to match the stroke-icon idiom used elsewhere (e.g. verify-email-banner's dismiss icon). */
function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path
        d="M4.5 10.5l3.5 3.5 7.5-8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Connect a social channel. For providers with a real OAuth start route this
 * asks the API (authenticated) for the provider's authorize URL, then redirects
 * the browser there. A start request can't be a plain navigation — the API needs
 * the Bearer token — so it runs as a fetch with explicit connecting/error states.
 * Providers without a start route render as a clearly disabled "Coming soon"
 * control — never a silent no-op.
 *
 * When `connected` is true, the button instead renders an inert "Connected"
 * state — already-connected channels aren't reconnectable from here.
 */
export function SocialConnectButton({
  provider,
  label,
  hint,
  variant = "pill",
  surface = "light",
  connected = false,
}: SocialConnectButtonProps) {
  const available = hasOAuthStart(provider);
  const [status, setStatus] = useState<ConnectStatus>("idle");
  const connecting = status === "connecting";

  async function handleConnect() {
    if (connected || !available || connecting) return;
    // Narrow Platform → OAuthProvider for the typed start call.
    if (!hasOAuthStart(provider)) return;
    setStatus("connecting");
    try {
      const url = await startConnect(provider);
      // Leave the SPA for the provider's consent screen.
      window.location.href = url;
    } catch {
      // Surface a retryable error instead of a silent failure.
      setStatus("error");
    }
  }

  const focusRing =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

  if (variant === "card") {
    const bottomLine = connected
      ? "Connected"
      : !available
        ? "Coming soon"
        : connecting
          ? "Connecting…"
          : status === "error"
            ? "Couldn't start — retry"
            : "Connect →";

    return (
      <button
        type="button"
        onClick={handleConnect}
        disabled={connected || !available || connecting}
        aria-busy={connecting}
        aria-label={
          connected
            ? `${label} — connected`
            : available
              ? `Connect ${label}`
              : `${label} — coming soon`
        }
        className={cn(
          "interactive group flex flex-col items-start rounded-xl border p-4 text-left",
          focusRing,
          connected
            ? "cursor-default border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/40"
            : available
              ? "border-border hover:-translate-y-px hover:border-brand-300 hover:bg-brand-surface/40"
              : "cursor-not-allowed border-border bg-surface-muted opacity-70",
          connecting && "cursor-wait",
        )}
      >
        <span className="flex items-center gap-2 font-medium text-foreground">
          <span className={cn("h-2 w-2 rounded-full", PLATFORM_DOT_COLOR[provider])} />
          {label}
        </span>
        {hint ? <span className="mt-1 text-xs text-subtle">{hint}</span> : null}
        <span
          {...(status === "error" ? { role: "alert" } : {})}
          className={cn(
            "mt-3 inline-flex items-center gap-1 text-xs font-medium",
            connected
              ? "text-emerald-700 dark:text-emerald-300"
              : status === "error"
                ? "text-red-600 dark:text-red-400"
                : available
                  ? "text-brand-600 dark:text-brand-fg"
                  : "text-subtle",
          )}
        >
          {connected ? <CheckIcon /> : null}
          {bottomLine}
        </span>
      </button>
    );
  }

  const isDark = surface === "dark";
  const pillLabel = connecting ? "Connecting…" : label;

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleConnect}
        disabled={connected || !available || connecting}
        aria-busy={connecting}
        aria-label={
          connected
            ? `${label} — connected`
            : available
              ? `Connect ${label}`
              : `${label} — coming soon`
        }
        title={connected || available ? undefined : "Coming soon"}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors",
          focusRing,
          isDark
            ? "border-white/15 bg-white/5 text-zinc-100 hover:bg-white/10 focus-visible:outline-white/60"
            : "border-border bg-surface text-foreground hover:bg-surface-muted",
          connected && "cursor-default hover:bg-transparent",
          !connected && !available && "cursor-not-allowed opacity-60 hover:bg-transparent",
          connecting && "cursor-wait opacity-80",
        )}
      >
        <span className={cn("h-2 w-2 rounded-full", PLATFORM_DOT_COLOR[provider])} />
        {pillLabel}
        {connected ? (
          <span
            className={cn(
              "ml-1 inline-flex items-center gap-1 text-xs font-medium",
              isDark ? "text-emerald-300" : "text-emerald-600",
            )}
          >
            <CheckIcon />
            Connected
          </span>
        ) : !available ? (
          <span className={cn("ml-1 text-xs", isDark ? "text-zinc-400" : "text-subtle")}>
            soon
          </span>
        ) : null}
      </button>
      {status === "error" ? (
        <span
          role="alert"
          className={cn("text-xs", isDark ? "text-red-300" : "text-red-600")}
        >
          Couldn't start connecting — try again.
        </span>
      ) : null}
    </span>
  );
}
