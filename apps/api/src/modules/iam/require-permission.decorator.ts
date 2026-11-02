import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS = 'iam:requiredPermissions';

/**
 * Lets the route through only when the caller holds **all** the listed catalogue permissions
 * (checked by the global `PermissionGuard`). On a controller and a handler, both lists apply.
 */
export const RequirePermission = (...keys: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS, keys);
