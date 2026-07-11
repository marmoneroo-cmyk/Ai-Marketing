"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AuthHero, BrandWordmark } from "@/components/auth-hero";
import { setSession } from "@/lib/api";

/**
 * Landing page for the "Continue with Google" hand-off. The API redirects
 * here with the access token in the URL FRAGMENT (`#token=…`), never a query
 * param — see `apps/api/src/auth/google-oauth.controller.ts`. A fragment is
 * never sent to any server (not even ours), never appears in access/proxy
 * logs, and never leaks via `Referer`, unlike a query string.
 *
 * This client-side hand-off exists because `window.location.hash` is only
 * readable in the browser: the API is cross-origin from the web app, so it
 * cannot set the web app's (non-HttpOnly) token cookie directly — only this
 * page's own `setToken()` call (from `@/lib/api`) can.
 */
function CallbackGate() {
  const router = useRouter();
  // Guards against React 19 StrictMode's dev-mode double-invoke re-running
  // this effect on the same mounted instance (mirrors verify-email/page.tsx).
  // Set synchronously, before any navigation, so a second invocation is a
  // pure no-op rather than racing a second `router.replace`.
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token");
    const refresh = params.get("refresh");
    if (token) {
      setSession(token, refresh ?? undefined);
      router.replace("/onboarding");
    } else {
      router.replace("/login?oauth_error=google_failed");
    }
  }, [router]);

  return (
    <div role="status" aria-live="polite" className="w-full max-w-sm">
      <div className="lg:hidden">
        <BrandWordmark />
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground lg:mt-0">
        Signing you in…
      </h1>
      <div className="mt-4 flex items-center gap-2.5 text-sm text-muted">
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-brand-600"
        />
        One moment.
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <main className="app-canvas grid min-h-dvh lg:grid-cols-2">
      <AuthHero />
      <section className="flex items-center justify-center px-6 py-16">
        <CallbackGate />
      </section>
    </main>
  );
}
