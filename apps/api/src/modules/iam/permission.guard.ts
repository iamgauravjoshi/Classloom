import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { REQUIRED_PERMISSIONS } from './require-permission.decorator';

/** The caller lacks a permission the route needs. */
export class PermissionDeniedException extends ForbiddenException {
  constructor() {
    super({
      type: 'permission-denied',
      title: "You don't have permission to do this.",
      message: 'Ask your school admin for access.',
    });
  }
}

/**
 * Global guard registered after `AuthGuard`: a route marked `@RequirePermission(...)` needs every
 * listed key in `request.auth.permissions` (computed per request, so a change applies to the next
 * request). Routes without the decorator pass. The decorator wins over `@Public()`: a public route
 * that also requires a permission still needs a session holding it.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndMerge<string[]>(REQUIRED_PERMISSIONS, targets);
    if (required.length === 0) return true;

    // A required permission wins over `@Public()`: the route still needs a session holding it.
    const auth = context.switchToHttp().getRequest<Request>().auth;
    if (!auth) throw new UnauthorizedException('Sign in to continue');
    if (!required.every((key) => auth.permissions.has(key))) throw new PermissionDeniedException();
    return true;
  }
}
