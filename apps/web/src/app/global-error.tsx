"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/telemetry";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Last-resort error boundary. It catches failures in the ROOT layout itself —
 * which the per-segment `(app)/error.tsx` cannot, because that boundary lives
 * *inside* the root layout. When it fires, Next.js replaces the whole document,
 * so this component must render its own `<html>`/`<body>`.
 *
 * It is deliberately styled with inline styles (no Tailwind / globals.css) so it
 * still renders correctly even if the CSS pipeline is what failed. This is the
 * one boundary that must never itself depend on anything that could be broken.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Surface for observability: browser console + the client-error beacon
    // (best-effort; fully guarded so it can never worsen a root-layout failure).
    console.error("Root layout error:", error);
    reportClientError(error, error.digest ? { digest: error.digest } : {});
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          backgroundColor: "#fafafa",
          color: "#18181b",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <main
          style={{
            maxWidth: "26rem",
            width: "100%",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "3.5rem",
              height: "3.5rem",
              borderRadius: "1rem",
              backgroundColor: "#fef2f2",
              color: "#dc2626",
              fontSize: "1.75rem",
              lineHeight: 1,
            }}
          >
            !
          </span>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: "1.125rem",
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
              Something went wrong
            </h1>
            <p
              style={{
                margin: "0.375rem 0 0",
                fontSize: "0.875rem",
                lineHeight: 1.5,
                color: "#71717a",
              }}
            >
              BrandPilot hit an unexpected error while loading. Please try again
              — if it keeps happening, reload the page.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                cursor: "pointer",
                border: "none",
                borderRadius: "0.75rem",
                padding: "0.625rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "#ffffff",
                backgroundColor: "#4f46e5",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                cursor: "pointer",
                borderRadius: "0.75rem",
                padding: "0.625rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "#18181b",
                backgroundColor: "#ffffff",
                border: "1px solid #e4e4e7",
              }}
            >
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
