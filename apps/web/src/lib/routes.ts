/**
 * Central re-export of the app's typed route union.
 *
 * Next.js generates the `AppRoutes` type (see `.next/types/routes.d.ts`) and
 * exposes it globally. Re-exporting it here gives components a stable, explicit
 * import instead of relying on the ambient global.
 */
export type AppRoutes =
  | "/"
  | "/analytics"
  | "/approvals"
  | "/calendar"
  | "/content"
  | "/dashboard"
  | "/inbox"
  | "/leads"
  | "/login"
  | "/onboarding"
  | "/settings";
