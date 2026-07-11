/**
 * Resilient HTTP for external APIs (Claude, Voyage, Meta, fal, …). A single
 * transient blip — a rate-limit (429), an overload (529/503), a 5xx, a dropped
 * socket — should not fail an autonomous job, and a hung connection must never
 * stall a worker forever. This wraps `fetch` with a per-attempt timeout and a
 * bounded retry+backoff so every external call gets the same hardening.
 */

/** Transient HTTP statuses worth retrying (429 = rate limit, 529 = overloaded). */
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 529]);

/** Retry/timeout policy. All fields overridable; tests pass 0 backoff. */
export interface RetryPolicy {
  /** Total attempts = initial + retries. */
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  /** Per-attempt network timeout so a hung socket never stalls a caller. */
  timeoutMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseBackoffMs: 500,
  maxBackoffMs: 8_000,
  timeoutMs: 60_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delay before the next attempt: honor a server `retry-after` (seconds) when
 * present, else exponential backoff with jitter — both capped at `maxBackoffMs`
 * (so a caller passing `maxBackoffMs: 0` never actually waits).
 */
function backoffMs(attempt: number, retryAfter: string | null, policy: RetryPolicy): number {
  const headerSeconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
  if (Number.isFinite(headerSeconds) && headerSeconds >= 0) {
    return Math.min(headerSeconds * 1000, policy.maxBackoffMs);
  }
  const expo = Math.min(policy.baseBackoffMs * 2 ** attempt, policy.maxBackoffMs);
  return Math.round(expo * (0.5 + Math.random() * 0.5)); // jitter → avoid thundering herd
}

/**
 * `fetch` with a per-attempt timeout + bounded retry/backoff on transient
 * failures (429/529/5xx/network/timeout), honoring `retry-after`.
 *
 * Returns the final `Response` for the caller to inspect — a success, a
 * non-retryable error response (e.g. 400/401 → returned immediately, since a
 * retry cannot help), or the last retryable error response after attempts are
 * exhausted. Throws ONLY when every attempt failed at the transport level
 * (network error / timeout) with no response to return.
 *
 * The caller owns response parsing (`res.ok`, `.json()`, `.text()`), so bespoke
 * error shapes stay with each client.
 */
export async function resilientFetch(
  url: string,
  init: RequestInit = {},
  policy: Partial<RetryPolicy> = {},
): Promise<Response> {
  const p: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...policy };
  let lastError: unknown;
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt < p.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), p.timeoutMs);
    let retryAfter: string | null = null;
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      // Success, or a non-retryable status → hand back immediately (fail fast).
      if (res.ok || !RETRYABLE_STATUS.has(res.status)) return res;
      // Retryable non-ok: keep as the fallback and (maybe) retry.
      lastResponse = res;
      retryAfter = res.headers.get('retry-after');
    } catch (err) {
      // Network failure or AbortError (our timeout) → transient, retry.
      lastError = err;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < p.maxAttempts - 1) {
      await sleep(backoffMs(attempt, retryAfter, p));
    }
  }

  if (lastResponse) return lastResponse; // exhausted retries on a retryable status
  throw lastError instanceof Error
    ? lastError
    : new Error(`resilientFetch: request to ${url} failed after ${p.maxAttempts} attempts`);
}
