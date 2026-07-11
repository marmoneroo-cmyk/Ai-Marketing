import pino from 'pino';
import type { Logger, LoggerOptions } from 'pino';

/**
 * Structured application logger built on pino.
 *
 * Configuration is env-driven and side-effect free at import time:
 * - `LOG_LEVEL` selects the minimum level (defaults to `info`).
 *
 * Pretty-printing in development is intentionally omitted to avoid an extra
 * `pino-pretty` dependency; pipe the process output through `pino-pretty`
 * locally if human-readable logs are desired.
 */

const DEFAULT_LEVEL = 'info';

/** Levels pino understands, used to validate the `LOG_LEVEL` env value. */
const VALID_LEVELS: readonly string[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

function resolveLevel(): string {
  const raw = process.env['LOG_LEVEL'];
  if (raw !== undefined && VALID_LEVELS.includes(raw)) {
    return raw;
  }
  return DEFAULT_LEVEL;
}

const options: LoggerOptions = {
  level: resolveLevel(),
};

/** Process-wide root logger. Prefer {@link childLogger} for scoped context. */
export const logger: Logger = pino(options);

/**
 * Create a child logger that tags every line with the given bindings (for
 * example `{ service: 'worker', queue: 'discovery' }`), so related logs can be
 * correlated without repeating the fields at each call site.
 */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
