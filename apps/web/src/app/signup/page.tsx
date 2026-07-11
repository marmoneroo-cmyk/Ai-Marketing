"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { validatePasswordStrength } from "@brandpilot/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthHero, BrandWordmark } from "@/components/auth-hero";
import { GoogleAuthButton } from "@/components/google-auth-button";
import { PasswordRequirements } from "@/components/password-requirements";
import { register } from "@/lib/api";
import { DEMO_MODE } from "@/lib/env";

function SignupForm() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register({
        orgName: orgName.trim(),
        email: email.trim(),
        password,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      // A brand-new org starts empty → send them straight to onboarding to
      // connect a channel + point us at their website.
      router.push("/onboarding");
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
        Create your workspace
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        Start your AI marketing department in minutes.
      </p>

      <div className="mt-8">
        <GoogleAuthButton />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          id="orgName"
          label="Business name"
          autoComplete="organization"
          required
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="Lumina Skin"
        />

        <Input
          id="name"
          label="Your name"
          hint="Optional"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ava Chen"
        />

        <Input
          id="email"
          label="Work email"
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

        {error ? (
          <p
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
          {loading ? "Creating your workspace…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-fg"
        >
          Sign in
        </Link>
      </p>

      {DEMO_MODE ? (
        <p className="mt-4 text-center text-xs text-subtle">
          Demo build — sign-up drops you into a sample workspace.
        </p>
      ) : null}
    </div>
  );
}

export default function SignupPage() {
  return (
    <main className="app-canvas grid min-h-dvh lg:grid-cols-2">
      <AuthHero />
      <section className="flex items-center justify-center px-6 py-16">
        <SignupForm />
      </section>
    </main>
  );
}
