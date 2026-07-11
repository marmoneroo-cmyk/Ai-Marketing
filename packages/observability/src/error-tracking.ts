import { logger } from './logger';

/**
 * Opt-in production error tracking via Sentry.
 *
 * Behaviour is env-gated and fail-safe, mirroring {@link initTelemetry}:
 * - If `SENTRY_DSN` is unset/empty, error tracking is disabled: we log that fact
 *   exactly once and every export becomes a no-op.
 * - Otherwise `@sentry/node` is loaded and initialised. Any failure while loading
 *   or initialising is swallowed (logged, never thrown) so an error-tracking
 *   problem can never crash the host application.
 *
 * The Sentry SDK is loaded via dynamic `import()` (like `telemetry.ts` loads the
 * OTel SDK) so the package typechecks and runs without the optional dependency
 * being installed until it is actually enabled.
 */

/** Loaded `@sentry/node` module, set once init succeeds; `null` until then. */
let sentry: typeof import('@sentry/node') | null = null;

/** Guards the disabled-log so it is emitted at most once per process. */
let disabledLogged = false;

export function initErrorTracking(serviceName: string): void {
  const dsn = process.env['SENTRY_DSN'];
  if (dsn === undefined || dsn === '') {
    if (!disabledLogged) {
      logger.info({ service: serviceName }, 'Error tracking disabled (SENTRY_DSN unset)');
      disabledLogged = true;
    }
    return;
  }

  void startSentry(serviceName, dsn);
}

async function startSentry(serviceName: string, dsn: string): Promise<void> {
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env['NODE_ENV'] ?? 'development',
      serverName: serviceName,
      tracesSampleRate: 0,
    });
    sentry = Sentry;
    logger.info({ service: serviceName }, 'Error tracking started');
  } catch (err: unknown) {
    logger.error({ service: serviceName, err }, 'Error tracking failed to start; continuing without it');
  }
}

/**
 * Report an error to Sentry. Safe to call before (or without) initialisation:
 * if Sentry is not initialised this is a no-op. Never throws.
 */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (sentry === null) return;
  try {
    sentry.captureException(err, context ? { extra: context } : undefined);
  } catch {
    // Never let error reporting itself surface an error.
  }
}
