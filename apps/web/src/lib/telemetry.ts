import { API_BASE } from "./env";

/** Context a React error boundary can attach to a client-error report. */
export interface ClientErrorContext {
  digest?: string;
  componentStack?: string;
}

/**
 * Best-effort client-error beacon → the API's `/telemetry/client-error`, which
 * forwards to the same Sentry pipeline as server errors. Without this, a browser
 * render crash only reaches the console and is invisible to production monitoring.
 *
 * Fire-and-forget: it NEVER throws (an error boundary must not itself fail) and
 * swallows all transport errors. Only the message + a size-capped stack/path are
 * sent, and the path is the pathname ONLY — never the query string, which can
 * carry one-shot tokens/OAuth codes.
 */
export function reportClientError(error: unknown, context: ClientErrorContext = {}): void {
  try {
    const raw = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const payload = JSON.stringify({
      message: raw.slice(0, 4000),
      ...(context.digest ? { digest: context.digest.slice(0, 256) } : {}),
      ...(context.componentStack
        ? { componentStack: context.componentStack.slice(0, 8000) }
        : {}),
      ...(typeof window !== "undefined"
        ? { path: window.location.pathname.slice(0, 512) }
        : {}),
    });
    void fetch(`${API_BASE}/telemetry/client-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      /* transport failure is non-fatal for a telemetry beacon */
    });
  } catch {
    /* telemetry must never break the error boundary */
  }
}
