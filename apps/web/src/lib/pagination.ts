/**
 * Pagination helpers shared by the list pages (content, leads, inbox, calendar).
 * Server components read `?page=` from `searchParams`; this normalizes it into a
 * safe 1-based page number regardless of missing/garbage/array input.
 */
import { redirect } from "next/navigation";

/** Search-params shape every paginated list page accepts. */
export interface PageSearchParams {
  page?: string | string[];
}

/**
 * Parse a `?page=` value into a 1-based page index. Missing, non-numeric,
 * zero/negative, or array values all collapse to page 1 so the UI never renders
 * an invalid page.
 */
export function parsePageParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * When a hand-edited `?page=` lands beyond the last page of a non-empty list,
 * redirect to the last valid page so the user sees data instead of an empty
 * table body. No-op on page 1 or for a genuinely empty dataset (which renders
 * its friendly empty state). Call right after fetching, before rendering.
 */
export function redirectIfPageOutOfRange(
  basePath: string,
  page: number,
  limit: number,
  total: number,
  itemCount: number,
): void {
  if (page > 1 && itemCount === 0 && total > 0) {
    const lastPage = Math.max(1, Math.ceil(total / limit));
    if (page > lastPage) redirect(`${basePath}?page=${lastPage}`);
  }
}
