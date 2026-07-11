import { SetMetadata } from '@nestjs/common';

/** Metadata key marking a route as public (no JWT / permissions guards). */
export const IS_PUBLIC_KEY = 'is_public';

/**
 * Mark a route (or controller) as public. Public routes deliberately omit the
 * JWT + permissions guards: they are machine-to-machine endpoints authenticated
 * by another mechanism (e.g. an HMAC signature on the raw request body).
 *
 * This is a documentation/marker decorator — public controllers simply do not
 * apply `@UseGuards(JwtAuthGuard, PermissionsGuard)`. It is also readable by any
 * global guard that wants to short-circuit on public routes.
 *
 * @example \@Public() \@Controller('connectors')
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
