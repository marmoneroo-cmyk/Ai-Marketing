import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { captureError } from '@brandpilot/observability';
import { Public } from '../auth/public.decorator';

/**
 * Bounded client-error payload. Fields are size-capped so a hostile client can't
 * balloon a Sentry event; everything is optional except the message.
 */
const clientErrorSchema = z.object({
  message: z.string().min(1).max(4000),
  digest: z.string().max(256).optional(),
  path: z.string().max(512).optional(),
  componentStack: z.string().max(8000).optional(),
});

/**
 * Client-error ingest. The web app's React error boundaries POST here so
 * browser-side crashes reach the SAME Sentry pipeline as server errors — without
 * this, a client render crash only hits the browser console and is invisible to
 * production monitoring.
 *
 * Hardening: `@Public()` because a crash can happen before/without auth (login,
 * the root layout), but tightly bounded — a per-IP throttle on top of the global
 * one, size-capped fields, malformed payloads DROPPED (a telemetry beacon must
 * never return an error), and it only forwards to `captureError`: no DB write and
 * no response body, so there is nothing to reflect or persist.
 */
@ApiTags('telemetry')
@Public()
@Controller('telemetry')
export class TelemetryController {
  @Post('client-error')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @HttpCode(204)
  @ApiOperation({ summary: 'Ingest a client-side error for monitoring (best-effort beacon)' })
  reportClientError(@Body() body: unknown): void {
    const parsed = clientErrorSchema.safeParse(body);
    // Drop malformed beacons silently — never 400 a fire-and-forget report.
    if (!parsed.success) return;

    const { message, digest, path, componentStack } = parsed.data;
    captureError(new Error(message), {
      source: 'web-client',
      ...(digest ? { digest } : {}),
      ...(path ? { path } : {}),
      ...(componentStack ? { componentStack } : {}),
    });
  }
}
