import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { AppError, type Permission, type Role } from '@brandpilot/core';
import { PermissionsGuard } from './permissions.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthContext } from './jwt.strategy';

/**
 * Build a key-aware Reflector stub. The guard now checks `IS_PUBLIC_KEY` first
 * (→ not public here) and then `REQUIRE_PERMISSIONS_KEY` (→ the given perms).
 */
function reflectorReturning(required: Permission[] | undefined): Reflector {
  return {
    getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? false : required),
  } as unknown as Reflector;
}

/** Build an ExecutionContext whose request carries the given auth (or none). */
function contextWithUser(user: AuthContext | undefined): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

function authFor(role: Role): AuthContext {
  return { userId: 'user-1', orgId: 'org-1', role };
}

describe('PermissionsGuard', () => {
  it('allows access when the role has the required permission', () => {
    const guard = new PermissionsGuard(reflectorReturning(['content:publish']));
    // marketer has content:publish per ROLE_PERMISSIONS.
    const ctx = contextWithUser(authFor('marketer'));

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies access when the role lacks the required permission', () => {
    const guard = new PermissionsGuard(reflectorReturning(['content:publish']));
    // viewer cannot publish content.
    const ctx = contextWithUser(authFor('viewer'));

    expect(() => guard.canActivate(ctx)).toThrowError(AppError);
  });

  it('denies with a forbidden AppError code for an insufficient role', () => {
    const guard = new PermissionsGuard(reflectorReturning(['billing:manage']));
    // admin explicitly lacks billing:manage; only owner has it.
    const ctx = contextWithUser(authFor('admin'));

    try {
      guard.canActivate(ctx);
      throw new Error('expected guard to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('forbidden');
    }
  });

  it('allows access when no permissions are required (auth-only route)', () => {
    const guard = new PermissionsGuard(reflectorReturning(undefined));
    const ctx = contextWithUser(authFor('viewer'));

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws unauthorized when a protected route has no authenticated user', () => {
    const guard = new PermissionsGuard(reflectorReturning(['content:read']));
    const ctx = contextWithUser(undefined);

    try {
      guard.canActivate(ctx);
      throw new Error('expected guard to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('unauthorized');
    }
  });

  it('grants an owner every listed permission', () => {
    const guard = new PermissionsGuard(reflectorReturning(['org:manage', 'billing:manage']));
    const ctx = contextWithUser(authFor('owner'));

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows a @Public route through even when permissions are declared and no user is present', () => {
    // IS_PUBLIC_KEY → true short-circuits before any role/user check.
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === IS_PUBLIC_KEY ? true : (['content:publish'] as Permission[]),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(guard.canActivate(contextWithUser(undefined))).toBe(true);
  });
});
