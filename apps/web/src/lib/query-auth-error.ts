import { ApiError } from '@classloom/api-client';

import { isPublicPath, signInRedirectFor, splitLocation } from './auth-redirect';
import { twoFactorSetupRedirect } from './setup-redirect';

/**
 * TanStack Query error hook: a `401` means the session ended (expired, signed out in another tab,
 * school suspended), so go to sign-in and come back to `location` (path plus query) afterwards.
 * Public pages are left alone: there a `401` is an answer (a wrong password), not a lost session.
 * A `403` `two-factor-setup-required` (a role started requiring two-step mid-visit) goes to the
 * setup page the same way.
 */
export function onQueryError(
  error: unknown,
  router: { replace: (href: string) => void },
  location: string,
): void {
  if (!(error instanceof ApiError)) return;
  if (isPublicPath(splitLocation(location).pathname)) return;
  if (error.status === 401) router.replace(signInRedirectFor(location));
  else if (error.status === 403 && error.problem.type.endsWith('two-factor-setup-required')) {
    const setup = twoFactorSetupRedirect(true, location);
    if (setup) router.replace(setup);
  }
}

/** QueryClient `retry`: one retry, but never for a `401` (the session has ended; redirect now). */
export function retryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status === 401) return false;
  return failureCount < 1;
}
