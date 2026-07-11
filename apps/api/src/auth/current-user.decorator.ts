import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthContext } from './jwt.strategy';

/**
 * Injects the authenticated user's AuthContext (userId, orgId, role) into a
 * handler parameter. Requires JwtAuthGuard on the route.
 *
 * @example handler(\@CurrentUser() user: AuthContext) {}
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext =>
    ctx.switchToHttp().getRequest<{ user: AuthContext }>().user,
);
