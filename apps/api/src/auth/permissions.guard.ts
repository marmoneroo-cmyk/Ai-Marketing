import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, AppError, type Permission } from '@brandpilot/core';
import { REQUIRE_PERMISSIONS_KEY } from './require-permissions.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthContext } from './jwt.strategy';

/**
 * Enforces `@RequirePermissions(...)` metadata against the caller's membership
 * role. Assumes JwtAuthGuard has already populated `req.user`. Throws AppError
 * (translated to the envelope by the global filter) rather than Nest's default.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // `@Public()` routes run without authentication, so there is no role to
    // check — skip. (Belt-and-suspenders alongside JwtAuthGuard's own bypass.)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No permission metadata → authentication alone is sufficient.
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthContext }>().user;
    if (!user) {
      throw new AppError('unauthorized', 'Authentication required');
    }

    const missing = required.filter((perm) => !hasPermission(user.role, perm));
    if (missing.length > 0) {
      throw new AppError('forbidden', `Missing required permission(s): ${missing.join(', ')}`);
    }

    return true;
  }
}
