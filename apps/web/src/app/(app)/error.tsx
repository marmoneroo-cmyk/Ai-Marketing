"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/telemetry";

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Branded error boundary for the authenticated app segment. */
export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    // Surface the failure for observability: dev console + the client-error
    // beacon so browser crashes reach Sentry (not just the console).
    console.error("App segment error:", error);
    reportClientError(error, error.digest ? { digest: error.digest } : {});
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true">
          <path
            d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          We couldn&apos;t load this view. This is usually a temporary
          connection issue with the BrandPilot API.
        </p>
        {error.message ? (
          <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-xs text-subtle">
            {error.message}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
