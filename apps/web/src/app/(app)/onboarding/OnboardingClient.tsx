"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SocialConnectButton } from "@/components/SocialConnectButton";
import {
  runDiscovery,
  getDna,
  getConnectorAvailability,
  type BusinessDna,
  type ConnectorAvailability,
} from "@/lib/api";
import type { ConnectedChannel } from "@/lib/types";

const SOCIALS: Array<{ key: keyof ConnectorAvailability; label: string; hint: string }> = [
  { key: "instagram", label: "Instagram", hint: "Posts, reels, comments, audience" },
  { key: "facebook", label: "Facebook", hint: "Page posts & Messenger" },
  { key: "tiktok", label: "TikTok", hint: "Videos & engagement" },
];

// "working" = discovery is taking longer than our poll window but is NOT an
// error — the job is still running in the background. Kept distinct from
// "error" so we never show a red failure for a slow-but-healthy run.
type Status = "idle" | "running" | "working" | "ready" | "error";

const MAX_POLLS = 20;
const POLL_INTERVAL_MS = 3000;

/**
 * Normalize a user-entered site URL: prepend `https://` when the scheme is
 * missing (owners usually type "yourbusiness.com") and reject anything that
 * isn't a plausible dotted hostname — so we give instant feedback instead of a
 * failed backend round-trip.
 */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

interface OnboardingClientProps {
  /** The org's currently connected channels, so a returning user sees real confirmation instead of a blank Connect CTA. */
  channels: ConnectedChannel[];
}

/**
 * Client-side onboarding flow: connect socials, run website discovery, and
 * show the resulting Business DNA. Split out from `page.tsx` so the server
 * page can fetch the org profile (for the verify-email banner) while this
 * piece owns all interactive state — mirrors the Settings/SettingsClient split.
 */
export function OnboardingClient({ channels }: OnboardingClientProps) {
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [dna, setDna] = useState<BusinessDna | null>(null);
  // Which connectors are actually configured server-side, so each Connect
  // button shows "Setup pending" instead of letting the user click into a 400.
  // Null while loading → treated optimistically as available (no disabled flash).
  const [availability, setAvailability] = useState<ConnectorAvailability | null>(null);

  // Real, derived-from-data connection state — not assumed. Only a channel the
  // API actually reports as "connected" counts, so a returning user gets
  // truthful confirmation instead of always re-prompting to connect.
  const connectedProviders = new Set(
    channels.filter((c) => c.status === "connected").map((c) => c.provider),
  );
  const connectedCount = connectedProviders.size;
  const hasConnectedChannel = connectedCount > 0;

  // Track mount state so the recursive polling loop never calls setState after
  // the user navigates away during the ~60s discovery window.
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  // Load connector availability once so buttons reflect real server-side config,
  // not just whether a route exists. A failure leaves everything optimistically
  // enabled (the button's own error state still catches a genuine misconfig).
  useEffect(() => {
    let cancelled = false;
    getConnectorAvailability()
      .then((a) => {
        if (!cancelled) setAvailability(a);
      })
      .catch(() => {
        /* leave null → buttons stay optimistically enabled */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Rehydrate any Business DNA the org already built, so a returning user sees
  // their saved analysis (and a dashboard CTA) instead of a blank form that
  // looks like nothing was ever saved — and never re-enters the same URL.
  useEffect(() => {
    let cancelled = false;
    getDna()
      .then((result) => {
        const populated =
          result.profile !== null &&
          ((result.profile.description ?? "").length > 0 ||
            (result.profile.categories?.length ?? 0) > 0);
        if (!cancelled && populated) {
          setDna(result);
          setStatus("ready");
        }
      })
      .catch(() => {
        /* no saved DNA yet, or fetch failed → leave the fresh form */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canStart = websiteUrl.trim().length > 0 && status !== "running";

  async function start(): Promise<void> {
    const normalized = normalizeUrl(websiteUrl);
    if (!normalized) {
      setStatus("error");
      setMessage("Enter a valid website URL, like https://yourbusiness.com.");
      return;
    }
    setStatus("running");
    setMessage("Scanning your business and building its Business DNA…");
    setDna(null);
    try {
      await runDiscovery({ websiteUrl: normalized });
      let attempts = 0;
      const poll = async (): Promise<void> => {
        attempts += 1;
        const result = await getDna();
        if (!active.current) return; // component unmounted mid-poll
        const populated =
          result.profile !== null &&
          ((result.profile.description ?? "").length > 0 ||
            (result.profile.categories?.length ?? 0) > 0);
        if (populated) {
          setDna(result);
          setStatus("ready");
          setMessage("");
          return;
        }
        if (attempts >= MAX_POLLS) {
          // Not an error — the worker is still analyzing. Tell the truth and
          // point the user to where the results actually land.
          setStatus("working");
          setMessage(
            "Still analyzing your business in the background — this can take a minute. Your Business DNA and first drafted posts will appear on the Content page shortly.",
          );
          return;
        }
        setTimeout(() => void poll(), POLL_INTERVAL_MS);
      };
      void poll();
    } catch (err: unknown) {
      if (!active.current) return; // component unmounted before the error surfaced
      setStatus("error");
      setMessage(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Set up your AI marketing department
        </h1>
        <p className="mt-2 text-muted">
          Connect your accounts and point us at your website. We&apos;ll learn
          your business and build its{" "}
          <span className="font-medium text-foreground">Business DNA</span>{" "}
          automatically.
        </p>
      </header>

      {/* Step 1 — connect accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xs uppercase tracking-wide text-subtle">
            1 · Connect accounts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Honest progress line: only claims a connection when the fetched
              channel data actually says so — never assumed or faked. */}
          <p className="mb-3 text-sm text-muted">
            {hasConnectedChannel ? (
              <>
                <span className="font-medium text-foreground">
                  ✓ {connectedCount} channel{connectedCount === 1 ? "" : "s"} connected
                </span>{" "}
                · connect more or continue to step 2
              </>
            ) : (
              "Connect at least one channel below, or skip ahead to step 2 (website)."
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {SOCIALS.map((s) => (
              <SocialConnectButton
                key={s.key}
                provider={s.key}
                label={s.label}
                hint={s.hint}
                variant="card"
                connected={connectedProviders.has(s.key)}
                configured={availability ? availability[s.key] : true}
              />
            ))}
          </div>
          <details className="mt-3 text-xs text-subtle">
            <summary className="cursor-pointer select-none font-medium text-muted hover:text-foreground">
              How do I connect Instagram or Facebook?
            </summary>
            <ol className="mt-2 ml-4 list-decimal space-y-1">
              <li>
                Make sure your Instagram is a{" "}
                <span className="font-medium text-foreground">Business or Creator</span> account
                (Instagram → Settings → Account type).
              </li>
              <li>
                Click <span className="font-medium text-foreground">Connect</span> above and sign in
                with Instagram to authorize BrandPilot — no Facebook Page needed. (Connecting a
                Facebook Page separately does require that Page.)
              </li>
            </ol>
            {availability && !availability.instagram ? (
              <p className="mt-2">
                Instagram &amp; Facebook aren&apos;t set up on this workspace yet — an admin needs
                to add Meta credentials. Website analysis below works right now.
              </p>
            ) : (
              <p className="mt-2">Website analysis below works right now.</p>
            )}
          </details>
        </CardContent>
      </Card>

      {/* Step 2 — website */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xs uppercase tracking-wide text-subtle">
            2 · Your website
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dna?.profile && status !== "running" && (
            <p className="mb-3 text-sm text-muted">
              <span className="font-medium text-foreground">
                ✓ Your Business DNA is already built
              </span>{" "}
              — it&apos;s shown below and saved. Re-run only to refresh it after
              your site changes.
            </p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Input
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://yourbusiness.com"
              aria-label="Your website URL"
              className="flex-1"
            />
            <Button
              type="button"
              onClick={() => void start()}
              disabled={!canStart}
              className="shrink-0"
            >
              {status === "running"
                ? "Analyzing…"
                : dna?.profile
                  ? "Re-analyze"
                  : "Build my Business DNA"}
            </Button>
          </div>
          {message.length > 0 && (
            <p
              className={
                status === "error"
                  ? "mt-3 text-sm text-red-600 dark:text-red-400"
                  : "mt-3 text-sm text-muted"
              }
            >
              {status === "running" && (
                <span className="mr-2 inline-block h-3 w-3 animate-pulse rounded-full bg-brand-500 align-middle" />
              )}
              {message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Result — Business DNA */}
      {dna?.profile && (
        <Card className="border-brand-200 dark:border-brand-900">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-brand-600 dark:text-brand-fg">
              Business DNA
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dna.profile.description && (
              <p className="mb-4 text-foreground">{dna.profile.description}</p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {dna.profile.usp && (
                <DnaField
                  label="Unique selling proposition"
                  value={dna.profile.usp}
                />
              )}
              {dna.profile.mission && (
                <DnaField label="Mission" value={dna.profile.mission} />
              )}
            </div>

            {(dna.profile.categories?.length ?? 0) > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {dna.profile.categories?.map((c) => (
                  <Badge key={c} tone="brand">
                    {c}
                  </Badge>
                ))}
              </div>
            )}

            {dna.personas.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
                  Customer personas
                </h3>
                <ul className="space-y-1">
                  {dna.personas.map((p, i) => (
                    <li key={i} className="text-sm text-muted">
                      • {p.name ?? "Persona"}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {dna.competitors.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
                  Competitors
                </h3>
                <ul className="space-y-1">
                  {dna.competitors.map((c, i) => (
                    <li key={i} className="text-sm text-muted">
                      • {c.name ?? "Competitor"}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted">
                Your AI marketing department is live. BrandPilot will start
                drafting content and handling messages automatically — track it
                all from your dashboard.
              </p>
              <Button asChild className="shrink-0">
                <Link href="/dashboard">Go to your dashboard →</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

interface DnaFieldProps {
  label: string;
  value: string;
}

function DnaField({ label, value }: DnaFieldProps) {
  return (
    <div className="rounded-xl border border-border bg-surface-muted/60 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-subtle">
        {label}
      </div>
      <div className="mt-1 text-sm text-muted">{value}</div>
    </div>
  );
}
