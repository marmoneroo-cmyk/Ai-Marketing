import { cn } from "@/lib/cn";
import { PLATFORM_DOT_COLOR } from "@/lib/platform";
import type { Platform } from "@/lib/types";

const SOCIALS: Array<{ provider: Platform; label: string }> = [
  { provider: "instagram", label: "Instagram" },
  { provider: "facebook", label: "Facebook" },
  { provider: "tiktok", label: "TikTok" },
];

/** BrandPilot logo mark (icon only). */
export function BrandMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="M12 2.5l3 6.5 6.5 1-4.75 4.4L18 21l-6-3.4L6 21l1.25-6.6L2.5 10l6.5-1z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

/** Logo mark + wordmark. `onDark` keeps the text light for the dark hero. */
export function BrandWordmark({ onDark = false }: { onDark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      <span
        className={cn(
          "text-base font-semibold tracking-tight",
          onDark ? "text-white" : "text-foreground",
        )}
      >
        BrandPilot
      </span>
    </div>
  );
}

/**
 * Shared marketing hero for the auth pages (login + signup) — the left pane of
 * the two-column auth layout. Hidden below `lg`; on mobile the wordmark is shown
 * inside the form column instead. The channel chips are non-interactive (the live
 * connect flow requires an authenticated org, so it lives in onboarding/settings).
 *
 * The headline is marketing copy, not the page title — the form column's own
 * heading is the page's real `<h1>` (see signup/login pages), so this renders
 * as a styled `<p>` to keep a single, correct heading in the a11y tree instead
 * of a decorative `<h1>` that's hidden below `lg`.
 */
export function AuthHero() {
  return (
    <section className="relative hidden flex-col justify-between overflow-hidden bg-zinc-950 p-12 text-white lg:flex">
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          backgroundImage:
            "radial-gradient(40rem 30rem at 20% 0%, rgba(99,102,241,0.35), transparent 60%), radial-gradient(35rem 25rem at 100% 100%, rgba(139,92,246,0.30), transparent 55%)",
        }}
      />
      <div className="relative">
        <BrandWordmark onDark />
      </div>

      <div className="relative max-w-md">
        <p className="text-3xl font-semibold leading-tight tracking-tight">
          Your marketing team, running itself.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-zinc-300">
          Connect your channels once. BrandPilot writes the content, publishes at
          the right time, answers your DMs, qualifies leads, and books
          appointments — you just approve the moves that matter.
        </p>

        <div className="mt-8">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            Works with your channels
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {SOCIALS.map((s) => (
              <span
                key={s.provider}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-medium text-zinc-100"
              >
                <span className={cn("h-2 w-2 rounded-full", PLATFORM_DOT_COLOR[s.provider])} />
                {s.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="relative flex items-center gap-6 text-xs text-zinc-400">
        <span>&lt;15 min / week</span>
        <span className="h-1 w-1 rounded-full bg-zinc-600" />
        <span>Approved-knowledge only</span>
        <span className="h-1 w-1 rounded-full bg-zinc-600" />
        <span>Full audit trail</span>
      </div>
    </section>
  );
}
