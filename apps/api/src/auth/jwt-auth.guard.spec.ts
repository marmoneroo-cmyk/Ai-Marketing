import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * The globally-registered JwtAuthGuard is fail-closed: it authenticates every
 * route EXCEPT those marked `@Public()`. These tests cover the @Public bypass
 * branch (the new logic) without invoking passport's strategy machinery — the
 * non-public path delegates to the unchanged base AuthGuard('jwt').
 */
function contextStub(): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard @Public bypass', () => {
  it('allows a @Public route through without authentication', () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);

    expect(guard.canActivate(contextStub())).toBe(true);
  });

  it('reads @Public metadata from both the handler and the class', () => {
    const getAllAndOverride = vi.fn().mockReturnValue(true);
    const reflector = { getAllAndOverride } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);

    guard.canActivate(contextStub());

    expect(getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [undefined, undefined]);
  });
});
