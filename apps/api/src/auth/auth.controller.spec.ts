import { describe, expect, it } from 'vitest';
import type { ArgumentMetadata } from '@nestjs/common';
import { AppError } from '@brandpilot/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RegisterBody } from './auth.controller';

/**
 * Behavioural tests for the register route's request validation. The
 * `password` field is validated by the SHARED `passwordSchema` from
 * `@brandpilot/core` (packages/core/src/password.ts) via the global
 * ZodValidationPipe. These tests drive that exact pipe + metatype pairing —
 * the same integration point Nest uses at request time — without spinning up
 * a full HTTP server, mirroring how `all-exceptions.filter.spec.ts` drives
 * the exception filter directly.
 */
const metadata: ArgumentMetadata = { type: 'body', metatype: RegisterBody, data: undefined };

function parseRegisterBody(body: unknown): unknown {
  return new ZodValidationPipe().transform(body, metadata);
}

describe('AuthController register password validation', () => {
  it('rejects a weak password (e.g. "password") as a validation_error (client/bad-request-class failure)', () => {
    try {
      parseRegisterBody({
        email: 'new@biz.co',
        password: 'password',
        orgName: 'Biz',
      });
      throw new Error('expected validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe('validation_error');
      // validation_error is a 4xx client failure (422) in this codebase's
      // code->status table (packages/core/src/errors.ts) — the same "bad
      // request" class of response a weak password should produce.
      expect(appError.statusCode).toBe(422);
    }
  });

  it('rejects passwords missing a required character class even when long enough', () => {
    expect(() =>
      parseRegisterBody({
        email: 'new@biz.co',
        password: 'alllowercase1', // no uppercase, no special character
        orgName: 'Biz',
      }),
    ).toThrow(AppError);
  });

  it('accepts a strong password satisfying the shared policy and leaves the rest of the body intact', () => {
    const result = parseRegisterBody({
      email: 'new@biz.co',
      password: 'Correct-Horse-1',
      orgName: 'Biz',
    }) as { email: string; password: string; orgName: string };

    expect(result).toEqual({
      email: 'new@biz.co',
      password: 'Correct-Horse-1',
      orgName: 'Biz',
    });
  });
});
