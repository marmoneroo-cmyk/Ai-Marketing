"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthHero, BrandWordmark } from "@/components/auth-hero";
import { requestPasswordReset } from "@/lib/api";
import { DEMO_MODE } from "@/lib/env";

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Move focus to the error message as soon as it appears, so keyboard/screen
  // reader users land on the failure instead of having to hunt for it.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
    } catch {
      // requestPasswordReset (lib/api.ts) never rejects — this catch is
      // defense-in-depth only, so a future change there can't leak account
      // existence via an error branch here.
    } finally {
      // Always show the same generic confirmation, whether or not the request
      // "succeeded" — anti-enumeration parity with the API, which never
      // reveals whether the email exists.
      setLoading(false);
      setSubmitted(true);
    }
  }

  if (submitted) {
    return (
      <div role="status" aria-live="polite" className="w-full max-w-sm">
        <div className="lg:hidden">
          <BrandWordmark />
        </div>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground lg:mt-0">
          Check your inbox
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          If an account exists for that email, we&apos;ve sent a password
          reset link. Check your inbox.
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

  return (
    <div role="status" aria-live="polite" className="w-full max-w-sm">
      <div className="lg:hidden">
        <BrandWordmark />
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground lg:mt-0">
        Forgot your password?
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        Enter your email and we&apos;ll send you a link to reset it.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
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

        {error ? (
          <p
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 ring-1 ring-inset ring-red-100 dark:bg-red-950 dark:text-red-300 dark:ring-red-900"
          >
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        <Link
          href="/login"
          className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-fg"
        >
          Back to sign in
        </Link>
      </p>

      {DEMO_MODE ? (
        <p className="mt-4 text-center text-xs text-subtle">
          Demo build — no email is actually sent.
        </p>
      ) : null}
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <main className="app-canvas grid min-h-dvh lg:grid-cols-2">
      <AuthHero />
      <section className="flex items-center justify-center px-6 py-16">
        <ForgotPasswordForm />
      </section>
    </main>
  );
}
