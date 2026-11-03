import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { REQUIRED_PERMISSIONS } from '../iam/require-permission.decorator';
import { IS_PUBLIC } from './public.decorator';
import {
  ALLOW_DURING_TWO_FACTOR_SETUP,
  TwoFactorSetupGuard,
  TwoFactorSetupRequiredException,
} from './two-factor-setup.guard';

function contextFor(meta: Record<string, unknown>, setupRequired = true): ExecutionContext {
  const handler = () => undefined;
  for (const [key, value] of Object.entries(meta)) Reflect.defineMetadata(key, value, handler);
  class Ctl {}
  return {
    getHandler: () => handler,
    getClass: () => Ctl,
    switchToHttp: () => ({
      getRequest: () => ({ auth: { twoFactorSetupRequired: setupRequired } }),
    }),
  } as unknown as ExecutionContext;
}

describe('TwoFactorSetupGuard', () => {
  const guard = new TwoFactorSetupGuard(new Reflector());

  it('lets a session that needs no setup through anywhere', () => {
    expect(guard.canActivate(contextFor({}, false))).toBe(true);
  });

  it('blocks an unmarked route while setup is required', () => {
    expect(() => guard.canActivate(contextFor({}))).toThrow(TwoFactorSetupRequiredException);
  });

  it('allows a marked route and a public route with no permission', () => {
    expect(guard.canActivate(contextFor({ [ALLOW_DURING_TWO_FACTOR_SETUP]: true }))).toBe(true);
    expect(guard.canActivate(contextFor({ [IS_PUBLIC]: true }))).toBe(true);
  });

  it('blocks a public route that also requires a permission', () => {
    expect(() =>
      guard.canActivate(contextFor({ [IS_PUBLIC]: true, [REQUIRED_PERMISSIONS]: ['iam.view'] })),
    ).toThrow(TwoFactorSetupRequiredException);
  });
});
