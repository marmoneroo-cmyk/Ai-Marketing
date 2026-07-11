import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@brandpilot/core';

/** Metadata key holding the permissions required by a handler. */
export const REQUIRE_PERMISSIONS_KEY = 'require_permissions';

/**
 * Declare the permissions a route requires. The PermissionsGuard checks each
 * against the caller's role via `hasPermission`. All listed permissions must be
 * satisfied (AND semantics).
 *
 * @example \@RequirePermissions('content:publish')
 */
export const RequirePermissions = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions);
