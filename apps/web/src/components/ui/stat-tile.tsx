import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { AppRoutes } from "@/lib/routes";

interface StatTileProps {
  label: string;
  value: string;
  delta?: number;
  icon?: ReactNode;
  /**
   * When set, the tile becomes a drill-down link to the detail view — which is
   * what earns it the hover-lift affordance. Without an href it renders as a
   * plain static tile (no misleading hover), never a dead click target.
   */
  href?: AppRoutes;
}

function TrendArrow({ up }: { up: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className="h-3 w-3"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={up ? "M6 2.5v7M6 2.5 3 5.5M6 2.5 9 5.5" : "M6 9.5v-7M6 9.5 3 6.5M6 9.5 9 6.5"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StatTile({ label, value, delta, icon, href }: StatTileProps) {
  const hasDelta = typeof delta === "number";
  const isUp = (delta ?? 0) >= 0;

  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted">{label}</span>
        {icon ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-surface text-brand-600 dark:text-brand-fg">
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold tracking-tight text-foreground">
          {value}
        </span>
        {hasDelta ? (
          <span
            className={cn(
              "mb-0.5 inline-flex items-center gap-0.5 text-xs font-medium",
              isUp
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-500 dark:text-red-400",
            )}
          >
            <TrendArrow up={isUp} />
            {Math.abs(delta ?? 0).toFixed(1)}%
          </span>
        ) : null}
      </div>
    </>
  );

  const baseClass =
    "rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-zinc-900/[0.03] dark:shadow-black/20";

  // With an href the tile is a real drill-down link (hover-lift earned + focus
  // ring); without one it's a static tile — no `interactive-card` hover, so it
  // never promises a click it can't deliver.
  if (href) {
    return (
      <Link
        href={href}
        aria-label={`${label} — view details`}
        className={cn(
          "interactive-card block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          baseClass,
        )}
      >
        {body}
      </Link>
    );
  }

  return <div className={baseClass}>{body}</div>;
}
