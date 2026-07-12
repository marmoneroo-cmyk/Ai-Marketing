"use client";

import { Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthHero, BrandWordmark } from "@/components/auth-hero";
import { GoogleAuthButton } from "@/components/google-auth-button";
import { clearToken, login, refreshSession } from "@/lib/api";
import { DEMO_MODE } from "@/lib/env";
import type { AppRoutes } from "@/lib/routes";

/** Whitelist the post-login redirect to known in-app routes only. */
const SAFE_NEXT: AppRoutes[] = [
  "/dashboard",
  "/content",
  "/calendar",
  "/inbox",
  "/leads",
  "/analytics",
  "/onboarding",
  "/settings",
];

function resolveNext(raw: string | null): AppRoutes {
  if (!raw) return "/dashboard";
  const match = SAFE_NEXT.find((route) => raw === route || raw.startsWith(`${route}/`));
  return match ?? "/dashboard";
}

/**
 * Human-readable message for a `?oauth_error=` the API's Google OAuth
 * callback redirected back with (see
 * `apps/api/src/auth/google-oauth.controller.ts`). `null` for an unknown or
 * absent code so the page shows no alert by default.
 */
function mapOAuthError(code: string | null): string | null {
  switch (code) {
    case "email_registered":
      return "That email is registered — sign in with your password.";
    case "google_unavailable":
    case "google_failed":
      return "Google sign-in isn't available right now.";
    default:
      return null;
  }
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(DEMO_MODE ? "owner@luminaskin.co" : "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // A session that expired mid-use bounces here with ?session=expired. Before
  // showing the form, try to silently restore the session from the refresh
  // token (this is what lets a hard navigation with an expired access token
  // recover without a re-login). Only if that fails do we clear any dead token
  // and let the user sign in again.
  const sessionExpired = searchParams.get("session") === "expired";
  useEffect(() => {
    if (!sessionExpired) return;
    let cancelled = false;
    void (async () => {
      if (await refreshSession()) {
        if (!cancelled) router.replace(resolveNext(searchParams.get("next")));
      } else {
        clearToken();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionExpired, router, searchParams]);

  // A submit-time error takes priority over a stale oauth_error or the
  // session-expired notice left over from an earlier redirect; only one alert is
  // ever shown at a time.
  const displayError =
    error ??
    mapOAuthError(searchParams.get("oauth_error")) ??
    (sessionExpired ? "Your session expired — please sign in again." : null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      router.push(resolveNext(searchParams.get("next")));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="lg:hidden">
        <BrandWordmark />
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground lg:mt-0">
        Welcome back
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        Sign in to your command center.
      </p>

      <div className="mt-8">
        <GoogleAuthButton />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@business.com"
        />

        <div>
          <Input
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <p className="mt-1.5 text-right text-sm">
            <Link
              href="/forgot-password"
              className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-fg"
            >
              Forgot password?
            </Link>
          </p>
        </div>

        {displayError ? (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 ring-1 ring-inset ring-red-100 dark:bg-red-950 dark:text-red-300 dark:ring-red-900"
          >
            {displayError}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        New to BrandPilot?{" "}
        <Link
          href="/signup"
          className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-fg"
        >
          Create an account
        </Link>
      </p>

      {DEMO_MODE ? (
        <p className="mt-4 text-center text-xs text-subtle">
          Demo build — any password signs you into the sample workspace.
        </p>
      ) : null}

      <p className="mt-8 text-center text-xs text-subtle">
        <Link href="/privacy" className="hover:text-foreground">
          Privacy
        </Link>
        {" · "}
        <Link href="/terms" className="hover:text-foreground">
          Terms
        </Link>
        {" · "}
        <Link href="/data-deletion" className="hover:text-foreground">
          Data deletion
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="app-canvas grid min-h-dvh lg:grid-cols-2">
      <AuthHero />
      <section className="flex items-center justify-center px-6 py-16">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
