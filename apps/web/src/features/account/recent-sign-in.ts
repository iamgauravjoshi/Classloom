import { ApiError } from '@classloom/api-client';

/** `PUT /me/password` for a user with no password yet, when the sign-in is over 10 minutes old. */
export function isRecentSignInRequired(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.problem.type.endsWith('recent-sign-in-required')
  );
}

/**
 * Where to send the person to prove themselves again: the sign-in page for their school, opened on
 * the email-code step (`reauth=1`), coming back to the account page.
 */
export function reauthPath(locale: string, schoolCode: string): string {
  const next = encodeURIComponent(`/${locale}/account`);
  return `/${locale}/sign-in?school=${encodeURIComponent(schoolCode)}&next=${next}&reauth=1`;
}
