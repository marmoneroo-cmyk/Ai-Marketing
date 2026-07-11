import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException, Logger, type ArgumentsHost } from '@nestjs/common';
import { AppError } from '@brandpilot/core';

// Mock error tracking so the filter's captureError calls are observable and inert.
const { captureError } = vi.hoisted(() => ({ captureError: vi.fn() }));
vi.mock('@brandpilot/observability', () => ({ captureError }));

import { AllExceptionsFilter } from './all-exceptions.filter';

interface Captured {
  status: number;
  body: { success: boolean; error?: { code: string; message: string } };
}

/** Drive the filter with a fake Express response and capture what it writes. */
function run(exception: unknown): Captured {
  const captured: Captured = { status: 0 } as Captured;
  const json = (body: unknown) => {
    captured.body = body as Captured['body'];
  };
  const status = (code: number) => {
    captured.status = code;
    return { json };
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: '/x', method: 'GET' }),
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);
  return captured;
}

describe('AllExceptionsFilter', () => {
  beforeEach(() => {
    captureError.mockClear();
    // Silence the server-side error log the unknown-error path emits.
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('maps AppError to its statusCode + typed envelope, not reported', () => {
    const { status, body } = run(new AppError('not_found', 'Org not found'));
    expect(status).toBe(404);
    expect(body).toEqual({
      success: false,
      error: { code: 'not_found', message: 'Org not found' },
    });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('does not log or report an AppError representing an expected 4xx (conflict)', () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error');
    const { status } = run(new AppError('conflict', 'Email already exists'));
    expect(status).toBe(409);
    expect(captureError).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('does not log or report an AppError representing an expected 4xx (not_found)', () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error');
    const { status } = run(new AppError('not_found', 'Org not found'));
    expect(status).toBe(404);
    expect(captureError).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs and reports an AppError representing a genuine server fault (internal_error)', () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error');
    const { status, body } = run(new AppError('internal_error', 'Failed to create user'));
    expect(status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: { code: 'internal_error', message: 'Failed to create user' },
    });
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('maps a Nest HttpException to the right status + code (4xx not reported)', () => {
    const { status, body } = run(new BadRequestException('Bad input'));
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('bad_request');
    expect(body.error?.message).toContain('Bad input');
    expect(captureError).not.toHaveBeenCalled();
  });

  it('returns a generic 500 for unknown errors WITHOUT leaking internals, and reports it', () => {
    const { status, body } = run(new Error('secret connection string in stack'));
    expect(status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: { code: 'internal_error', message: 'An unexpected error occurred' },
    });
    // The raw error detail must never reach the client body.
    expect(JSON.stringify(body)).not.toContain('secret connection string');
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});
