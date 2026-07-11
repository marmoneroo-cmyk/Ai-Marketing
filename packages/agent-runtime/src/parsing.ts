/**
 * Shared, dependency-free parsing + coercion helpers for model output.
 *
 * Every module used to carry its own private copy of these (a `sliceJson`
 * extractor plus `asString` / `asStringArray` / `asRecord` / clamp helpers).
 * This is the single source of truth; modules import from
 * `@brandpilot/agent-runtime` instead of re-implementing them.
 */

/** Options controlling which JSON literal to isolate from a noisy model answer. */
export interface ExtractJsonOptions {
  /**
   * When true, prefer a top-level array (`[ ... ]`) over an object (`{ ... }`)
   * when the array opens before the first object. Preserves the array-vs-object
   * disambiguation the optimization recommendations parser relies on.
   */
  preferArray?: boolean;
}

/**
 * Isolate the JSON literal embedded in a model answer, tolerating prose around
 * it. Returns the original text unchanged when no balanced slice is found, so
 * callers can hand the result straight to `JSON.parse` inside a try/catch.
 *
 * With `preferArray`, an array that opens before the first `{` wins; otherwise
 * the first `{ … }` object is used. This mirrors the historical optimization
 * behavior where the model may return either a bare array or an envelope.
 */
export function extractJsonSlice(text: string, opts: ExtractJsonOptions = {}): string {
  const objStart = text.indexOf('{');

  if (opts.preferArray) {
    const arrStart = text.indexOf('[');
    const useArray = arrStart >= 0 && (objStart < 0 || arrStart < objStart);
    const open = useArray ? '[' : '{';
    const close = useArray ? ']' : '}';
    const from = text.indexOf(open);
    const to = text.lastIndexOf(close);
    return from >= 0 && to > from ? text.slice(from, to + 1) : text;
  }

  const end = text.lastIndexOf('}');
  return objStart >= 0 && end > objStart ? text.slice(objStart, end + 1) : text;
}

/**
 * Parse a model answer into `T`, tolerating surrounding prose, and fall back to
 * `fallback` on any malformed input. Never throws.
 */
export function parseModelJson<T>(text: string, fallback: T, opts: ExtractJsonOptions = {}): T {
  try {
    return JSON.parse(extractJsonSlice(text, opts)) as T;
  } catch {
    return fallback;
  }
}

/** Coerce an unknown into a string (empty string when it is not one). */
export const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Coerce an unknown into a string[] (drops non-string members). */
export const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];

/** Coerce an unknown into a plain record ({} for arrays, null, or non-objects). */
export const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Clamp `n` into `[min, max]`. Non-finite / non-numeric input yields `fallback`,
 * which is itself clamped so the result is always inside the range.
 */
export function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const base = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(max, base));
}
