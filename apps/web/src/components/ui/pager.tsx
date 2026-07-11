import Link from "next/link";
import { Button } from "@/components/ui/button";

interface PagerProps {
  /** Current 1-based page (as fetched). */
  page: number;
  /** Items per page. */
  limit: number;
  /** Total items across all pages. */
  total: number;
  /** Route the page links point at, e.g. "/leads". */
  basePath: string;
}

/**
 * Compact pager for server-rendered list pages. Renders a "Showing X–Y of Z"
 * summary plus Prev/Next links that set `?page=`. Renders nothing when
 * everything fits on a single page, so small datasets stay uncluttered.
 *
 * The incoming `page` is clamped to the valid range for display/link math, so a
 * hand-edited out-of-range `?page=` never produces nonsensical labels or links.
 */
export function Pager({ page, limit, total, basePath }: PagerProps) {
  const lastPage = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), lastPage);

  // Everything fits on one page → no pager chrome.
  if (lastPage <= 1) return null;

  const from = total === 0 ? 0 : (safePage - 1) * limit + 1;
  const to = Math.min(safePage * limit, total);
  const hasPrev = safePage > 1;
  const hasNext = safePage < lastPage;

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-4 pt-2 text-sm text-muted"
    >
      <p className="tabular-nums">
        Showing <span className="font-medium text-foreground">{from}</span>–
        <span className="font-medium text-foreground">{to}</span> of{" "}
        <span className="font-medium text-foreground">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Button asChild variant="secondary" size="sm">
            <Link
              href={`${basePath}?page=${safePage - 1}`}
              rel="prev"
              aria-label="Previous page"
            >
              Previous
            </Link>
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled aria-label="Previous page">
            Previous
          </Button>
        )}
        <span className="tabular-nums text-xs text-subtle">
          Page {safePage} of {lastPage}
        </span>
        {hasNext ? (
          <Button asChild variant="secondary" size="sm">
            <Link
              href={`${basePath}?page=${safePage + 1}`}
              rel="next"
              aria-label="Next page"
            >
              Next
            </Link>
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled aria-label="Next page">
            Next
          </Button>
        )}
      </div>
    </nav>
  );
}
