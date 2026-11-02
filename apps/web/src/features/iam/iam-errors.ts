import { ApiError } from '@classloom/api-client';

export type IamError =
  | 'lastOwner'
  | 'alreadyMember'
  | 'alreadyInvited'
  | 'permissionDenied'
  | 'recentSignIn'
  | 'twoFactorOff'
  | 'rateLimited'
  | 'generic';

const typeIs = (error: ApiError, name: string) => error.problem.type.endsWith(name);

/**
 * The Members API's refusals: 409 `last-owner`, `already-member`, `already-invited` and
 * `two-factor-off`; 403 `permission-denied` and `recent-sign-in-required` (reset two-step); a 429
 * is the 60-an-hour limit. The status is checked with the type, so a stray type names nothing.
 */
export function iamErrorOf(error: unknown): IamError {
  if (!(error instanceof ApiError)) return 'generic';
  if (error.status === 409) {
    if (typeIs(error, 'last-owner')) return 'lastOwner';
    if (typeIs(error, 'already-member')) return 'alreadyMember';
    if (typeIs(error, 'already-invited')) return 'alreadyInvited';
    if (typeIs(error, 'two-factor-off')) return 'twoFactorOff';
  }
  if (error.status === 403) {
    if (typeIs(error, 'permission-denied')) return 'permissionDenied';
    if (typeIs(error, 'recent-sign-in-required')) return 'recentSignIn';
  }
  if (error.status === 429) return 'rateLimited';
  return 'generic';
}

/** The fields a 400 names (`errors[].path`), once each. */
export function fieldErrorPaths(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.status !== 400) return [];
  return [...new Set((error.problem.errors ?? []).map((issue) => issue.path))];
}

/** A 404 or 409: the row changed or went away elsewhere, so the list is stale. */
export function isStale(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 409);
}
