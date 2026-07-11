import { cn } from "@/lib/cn";

interface SkeletonProps {
  className?: string;
}

/**
 * Neutral placeholder block used to build page loading states. A shimmer sweep
 * is layered on via `.skeleton-shimmer`, which is defined only under
 * `prefers-reduced-motion: no-preference` — so users who opt out get a calm,
 * static muted block with no movement.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "skeleton-shimmer rounded-lg border border-border/60 bg-surface-muted",
        className,
      )}
    />
  );
}

/** A card-shaped skeleton placeholder mirroring the real card chrome. */
export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-zinc-900/[0.03] dark:shadow-black/20",
        className,
      )}
    >
      <div className="space-y-3">
        <div className="skeleton-shimmer h-4 w-1/3 rounded-lg bg-surface-muted" />
        <div className="skeleton-shimmer h-8 w-2/3 rounded-lg bg-surface-muted" />
        <div className="skeleton-shimmer h-3 w-1/2 rounded-lg bg-surface-muted" />
      </div>
    </div>
  );
}
