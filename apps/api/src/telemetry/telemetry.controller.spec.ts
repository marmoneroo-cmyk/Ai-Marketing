import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the mock exists before the module-under-test imports it.
const { captureError } = vi.hoisted(() => ({ captureError: vi.fn() }));
vi.mock('@brandpilot/observability', () => ({ captureError }));

import { TelemetryController } from './telemetry.controller';

describe('TelemetryController', () => {
  let controller: TelemetryController;

  beforeEach(() => {
    controller = new TelemetryController();
    captureError.mockClear();
  });

  it('forwards a valid client error to captureError with web-client context', () => {
    controller.reportClientError({ message: 'Boom', digest: 'abc123', path: '/dashboard' });

    expect(captureError).toHaveBeenCalledTimes(1);
    const [err, ctx] = captureError.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Boom');
    expect(ctx).toMatchObject({ source: 'web-client', digest: 'abc123', path: '/dashboard' });
  });

  it('omits optional context fields when absent', () => {
    controller.reportClientError({ message: 'Solo error' });
    const [, ctx] = captureError.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(ctx).toEqual({ source: 'web-client' });
  });

  it('drops a payload with no message (no capture, no throw)', () => {
    expect(() => controller.reportClientError({ digest: 'x' })).not.toThrow();
    expect(captureError).not.toHaveBeenCalled();
  });

  it('drops non-object / null payloads', () => {
    controller.reportClientError('garbage');
    controller.reportClientError(null);
    controller.reportClientError(undefined);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('drops an over-long message (size cap enforced, no unbounded Sentry event)', () => {
    controller.reportClientError({ message: 'x'.repeat(5000) });
    expect(captureError).not.toHaveBeenCalled();
  });
});
