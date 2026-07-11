/**
 * Cross-cutting service contracts for performance + cost controls.
 *
 * These are dependency-injection seams only — no implementations live here.
 * Concrete adapters (Redis cache, DB/Redis spend meter) are wired in by the
 * app/composition layer and injected into the shared packages
 * (`business-brain`, `agent-runtime`) as optional deps.
 */

/**
 * Read-through cache abstraction. Implementations MUST treat a miss as
 * `null` (never throw for absence) and SHOULD swallow transport errors at the
 * call site rather than breaking the underlying operation.
 */
export interface Cache {
  /** Return the cached value for `key`, or `null` on miss / deserialize failure. */
  get<T>(key: string): Promise<T | null>;
  /** Store `value` under `key` for `ttlSeconds` seconds. */
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  /** Remove `key` (no-op if absent). */
  del(key: string): Promise<void>;
}

/** The metered spend categories a {@link SpendGuard} enforces per org. */
export type SpendKind = 'llm' | 'embedding' | 'media';

/**
 * Per-org spend/rate meter. Callers invoke {@link SpendGuard.consume} BEFORE
 * incurring cost so an over-cap org is stopped before it spends.
 *
 * Throws `AppError('rate_limited', ...)` when the per-org cap for `kind` is
 * exceeded.
 */
export interface SpendGuard {
  /** Charge `units` of `kind` against `orgId`; throws `rate_limited` when over cap. */
  consume(orgId: string, kind: SpendKind, units: number): Promise<void>;
}
