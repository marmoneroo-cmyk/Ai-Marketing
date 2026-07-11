import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthContext } from './jwt.strategy';

/**
 * Injects the current organization id (from the caller's membership, carried in
 * the JWT) into a handler parameter. Use this to scope every tenant query.
 *
 * @example handler(\@CurrentOrg() orgId: string) {}
 */
export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<{ user: AuthContext }>().user.orgId,
);
