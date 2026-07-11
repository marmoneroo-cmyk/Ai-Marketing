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
import { ToastProvider, useToast } from "@/components/ui/toast";
import { acceptInvite, getInvitePreview } from "@/lib/api";
import { roleLabel } from "@/lib/format";
import type { InvitePreview } from "@/lib/types";

type PreviewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; preview: InvitePreview };

function LoadingPanel() {
  return (
    <div role="status" aria-live="polite" className="w-full max-w-sm">
      <div className="lg:hidden">
        <BrandWordmark />
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground lg:mt-0">
        Checking your invitation
      </h1>
      <div className="mt-4 flex items-center gap-2.5 text-sm text-muted">
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-brand-600"
        />
        Checking your invitation…
      </div>
    </div>
  );
}

function InvalidInvitePanel() {
  return (
    <div role="status" aria-live="polite" className="w-full max-w-sm">
      <div className="lg:hidden">
        <BrandWordmark />
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground lg:mt-0">
        Invalid invitation
      </h1>
      <p
        role="alert"
        className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 ring-1 ring-inset ring-red-100 dark:bg-red-950 dark:text-red-300 dark:ring-red-900"
      >
        This invitation is invalid or has expired.
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

function AcceptInviteForm({
  token,
  preview,
}: {
  token: string;
  preview: InvitePreview;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const { needsPassword } = preview;
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Move focus to the error message as soon as it appears, so keyboard/screen
  // reader users land on the failure instead of having to hunt for it.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (needsPassword && password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      await acceptInvite({
        token,
        ...(needsPassword ? { password } : {}),
        ...(needsPassword && name.trim() ? { name: name.trim() } : {}),
      });
      notify(`You've joined ${preview.orgName}.`, "success");
      router.push("/dashboard");
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
        You&rsquo;ve been invited to join {preview.orgName}
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        as {roleLabel(preview.role)}
      </p>
      <p className="mt-1.5 text-sm text-subtle">{preview.email}</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        {needsPassword ? (
          <>
            <Input
              id="name"
              label="Your name"
              hint="Optional"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ava Chen"
            />

            <div>
              <Input
                id="password"
                label="Password"
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
          </>
        ) : null}

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
          disabled={
            loading || (needsPassword && !validatePasswordStrength(password).ok)
          }
        >
          {loading
            ? "Accepting…"
            : needsPassword
              ? "Accept & create account"
              : "Accept invitation"}
        </Button>
      </form>
    </div>
  );
}

function AcceptInviteGate() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<PreviewState>(
    token ? { status: "loading" } : { status: "error" },
  );
  // Latches true the instant the effect first runs (before the `await`), so a
  // second invocation — e.g. React 19 StrictMode's synchronous dev-mode
  // setup->cleanup->setup on the SAME mounted instance — sees it already set
  // and skips dispatching a second getInvitePreview call. See
  // verify-email/page.tsx for the full rationale (same guard, same reasoning:
  // no separate cancellation flag needed because React 19 treats `setState`
  // on an unmounted component as a safe no-op).
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    getInvitePreview(token)
      .then((preview) => setState({ status: "ready", preview }))
      .catch(() => setState({ status: "error" }));
  }, [token]);

  if (!token || state.status === "error") return <InvalidInvitePanel />;
  if (state.status === "loading") return <LoadingPanel />;
  return <AcceptInviteForm token={token} preview={state.preview} />;
}

export default function AcceptInvitePage() {
  return (
    <ToastProvider>
      <main className="app-canvas grid min-h-dvh lg:grid-cols-2">
        <AuthHero />
        <section className="flex items-center justify-center px-6 py-16">
          <Suspense fallback={<LoadingPanel />}>
            <AcceptInviteGate />
          </Suspense>
        </section>
      </main>
    </ToastProvider>
  );
}
