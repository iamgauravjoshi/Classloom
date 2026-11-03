import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { REQUIRED_PERMISSIONS } from '../iam/require-permission.decorator';
import { IS_PUBLIC } from './public.decorator';

export const ALLOW_DURING_TWO_FACTOR_SETUP = 'auth:allowDuringTwoFactorSetup';

/**
 * Marks a route a session may still use while it must set up two-step sign-in (spec §10): only
 * the session, sign-out, own-profile and two-step setup routes carry it.
 */
export const AllowDuringTwoFactorSetup = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_DURING_TWO_FACTOR_SETUP, true);

/**
 * True when a held role requires two-step sign-in and the user has not turned it on. Computed on
 * every request and at sign-in, so it follows role changes and enabling at once.
 */
export const needsTwoFactorSetup = (
  roles: readonly { requiresTwoFactor: boolean }[],
  totpEnabledAt: Date | null,
): boolean => totpEnabledAt === null && roles.some((role) => role.requiresTwoFactor);

/** The session must set up two-step sign-in before using this route. */
export class TwoFactorSetupRequiredException extends ForbiddenException {
  constructor() {
    super({
      type: 'two-factor-setup-required',
      title: 'Set up two-step sign-in to continue.',
      message: 'Your role requires two-step sign-in. Turn it on to continue.',
    });
  }
}

/**
 * Global guard registered after `AuthGuard`: a session that must set up two-step sign-in may use
 * only `@AllowDuringTwoFactorSetup()` routes. `@Public()` routes are unaffected unless they also
 * require a permission.
 */
@Injectable()
export class TwoFactorSetupGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const auth = context.switchToHttp().getRequest<Request>().auth;
    if (!auth?.twoFactorSetupRequired) return true;
    const targets = [context.getHandler(), context.getClass()];
    // A public route is exempt only when it needs no permission, as `PermissionGuard` sees it:
    // one that also requires a permission is used with a session, and the setup comes first.
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets);
    const required = this.reflector.getAllAndMerge<string[]>(REQUIRED_PERMISSIONS, targets);
    if (isPublic && required.length === 0) return true;
    if (
      this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_DURING_TWO_FACTOR_SETUP, targets)
    ) {
      return true;
    }
    throw new TwoFactorSetupRequiredException();
  }
}
