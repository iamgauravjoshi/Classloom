import { ApiError } from '@classloom/api-client';

import { isPublicPath, signInRedirectFor, splitLocation } from './auth-redirect';

/**
 * TanStack Query error hook: a `401` means the session ended (expired, signed out in another tab,
 * school suspended), so go to sign-in and come back to `location` (path plus query) afterwards.
 * Public pages are left alone: there a `401` is an answer (a wrong password), not a lost session.
 */
export function onQueryError(
  error: unknown,
  router: { replace: (href: string) => void },
  location: string,
): void {
  if (!(error instanceof ApiError) || error.status !== 401) return;
  if (isPublicPath(splitLocation(location).pathname)) return;
  router.replace(signInRedirectFor(location));
}
