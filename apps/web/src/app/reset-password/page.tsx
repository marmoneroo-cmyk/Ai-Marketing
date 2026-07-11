"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { validatePasswordStrength } from "@brandpilot/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthHero, BrandWordmark } from "@/components/auth-hero";
import { PasswordRequirements } from "@/components/password-requirements";
import { resetPassword } from "@/lib/api";

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

function InvalidLink() {
  return (
    <div className="w-full max-w-sm">
      <div className="lg:hidden">
        <BrandWordmark />
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground lg:mt-0">
        Invalid reset link
      </h1>
      <p
        role="alert"
        className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 ring-1 ring-inset ring-red-100 dark:bg-red-950 dark:text-red-300 dark:ring-red-900"
      >
        This reset link is invalid or has expired.
      </p>

      <p className="mt-6 text-center text-sm text-muted">
        <Link
          href="/forgot-password"
          className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-fg"
        >
          Request a new link
        </Link>
      </p>
    </div>
  );
}

function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Move focus to the error message as soon as it appears, so keyboard/screen
  // reader users land on the failure instead of having to hunt for it.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, password);
      setSucceeded(true);
      router.push("/login");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  if (succeeded) {
    return (
      <div role="status" aria-live="polite" className="w-full max-w-sm">
        <div className="lg:hidden">
          <BrandWordmark />
        </div>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground lg:mt-0">
          Password reset
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          Your password has been updated. Redirecting you to sign in…
        </p>

        <Button asChild className="mt-8 w-full">
          <Link href="/login">Continue to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className="w-full max-w-sm">
      <div className="lg:hidden">
        <BrandWordmark />
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground lg:mt-0">
        Set a new password
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        Choose a new password for your account.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <Input
            id="password"
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            hint="At least 8 characters, with uppercase, lowercase, a number, and a symbol"
          />
          <PasswordRequirements password={password} />
        </div>

        <Input
          id="confirmPassword"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter your password"
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

        <Button
          type="submit"
          className="w-full"
          disabled={loading || !validatePasswordStrength(password).ok}
        >
          {loading ? "Resetting…" : "Reset password"}
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
    </div>
  );
}

function ResetPasswordGate() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  return token ? <ResetPasswordForm token={token} /> : <InvalidLink />;
}

export default function ResetPasswordPage() {
  return (
    <main className="app-canvas grid min-h-dvh lg:grid-cols-2">
      <AuthHero />
      <section className="flex items-center justify-center px-6 py-16">
        <Suspense fallback={<LoadingPanel />}>
          <ResetPasswordGate />
        </Suspense>
      </section>
    </main>
  );
}
