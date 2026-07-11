import { Injectable, type ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Requires a valid JWT access token. Registered globally (APP_GUARD in
 * app.module) so authentication is FAIL-CLOSED by default: every route is
 * protected unless it explicitly opts out with `@Public()` (auth, health,
 * webhooks). A new controller that forgets a guard is therefore blocked (401)
 * rather than silently exposed. On success `req.user` is the typed AuthContext
 * from JwtStrategy.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
