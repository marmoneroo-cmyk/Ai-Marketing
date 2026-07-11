/**
 * Centralized, typed access to public environment configuration.
 *
 * `NEXT_PUBLIC_*` vars are inlined at build time, so these must be referenced
 * as static property accesses (not dynamic lookups) for Next.js to replace them.
 */

const API_URL_DEFAULT = "http://localhost:4000";

/** Base URL of the BrandPilot NestJS API. */
export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_URL ?? API_URL_DEFAULT;

/**
 * When true, the data layer falls back to mock data on connectivity failures
 * so the app renders without a backend. When false (default), failures throw
 * and empty responses surface real empty states.
 */
export const DEMO_MODE: boolean =
  process.env.NEXT_PUBLIC_DEMO_MODE === "true";
