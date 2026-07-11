"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AuthHero, BrandWordmark } from "@/components/auth-hero";
import { verifyEmail } from "@/lib/api";

type VerifyState = "verifying" | "success" | "error";

function VerifyingPanel() {
  return (
    <div role="status" aria-live="polite" className="w-full max-w-sm">
      <div className="lg:hidden">
        <BrandWordmark />
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground lg:mt-0">
        Verifying your email
      </h1>
      <div className="mt-4 flex items-center gap-2.5 text-sm text-muted">
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-brand-600"
        />
        Confirming your email…
      </div>
    </div>
  );
}

function SuccessPanel() {
  return (
    <div role="status" aria-live="polite" className="w-full max-w-sm">
      <div className="lg:hidden">
        <BrandWordmark />
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground lg:mt-0">
        Email verified
      </h1>
      <p className="mt-1.5 text-sm text-muted">Your email is verified.</p>

      <Button asChild className="mt-8 w-full">
        <Link href="/dashboard">Go to dashboard</Link>
      </Button>
    </div>
  );
}

function ErrorPanel() {
  return (
    <div role="status" aria-live="polite" className="w-full max-w-sm">
      <div className="lg:hidden">
        <BrandWordmark />
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground lg:mt-0">
        Verification failed
      </h1>
      <p
        role="alert"
        className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 ring-1 ring-inset ring-red-100 dark:bg-red-950 dark:text-red-300 dark:ring-red-900"
      >
        This verification link is invalid or has expired.
      </p>
      <p className="mt-4 text-sm text-muted">
        Sign in and resend the verification email from the app.
      </p>

      <p className="mt-6 text-center text-sm text-muted">
        <Link
          href="/login"
          className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-fg"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div role="status" aria-live="polite" className="w-full max-w-sm">
      <div className="lg:hidden">
        <BrandWordmark />
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground lg:mt-0">
        Loading…
      </h1>
      <div className="mt-4 flex items-center gap-2.5 text-sm text-muted">
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-brand-600"
        />
        Loading…
      </div>
    </div>
  );
}

function VerifyEmailGate() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<VerifyState>(token ? "verifying" : "error");
  // Latches true the instant the effect first runs (before the `await`), so a
  // second invocation — e.g. React 19 StrictMode's synchronous dev-mode
  // setup->cleanup->setup on the SAME mounted instance — sees it already set
  // and skips dispatching a second verifyEmail call. Without this, the 2nd
  // call would consume an already-used token and flip a real SUCCESS to
  // ERROR. A ref (not state) so the guard is set synchronously, before the
  // `await`, not on the next render.
  //
  // No separate "cancelled" cleanup flag is used to guard the `setState`
  // calls below: React 19 already treats `setState` on an unmounted
  // component as a safe no-op (it doesn't throw or warn), and a manual
  // per-effect cancel flag would be actively wrong here — StrictMode's
  // synthetic cleanup pass would mark the one-and-only in-flight request
  // "cancelled" and silently swallow its own result, even though the guard
  // above correctly declined to start a duplicate request.
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    verifyEmail(token)
      .then(() => setState("success"))
      .catch(() => setState("error"));
  }, [token]);

  if (state === "verifying") return <VerifyingPanel />;
  if (state === "success") return <SuccessPanel />;
  return <ErrorPanel />;
}

export default function VerifyEmailPage() {
  return (
    <main className="app-canvas grid min-h-dvh lg:grid-cols-2">
      <AuthHero />
      <section className="flex items-center justify-center px-6 py-16">
        <Suspense fallback={<LoadingPanel />}>
          <VerifyEmailGate />
        </Suspense>
      </section>
    </main>
  );
}
