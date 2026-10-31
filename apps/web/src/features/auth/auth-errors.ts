import { ApiError } from '@classloom/api-client';

/** Status 0 is `apiFetch`'s marker for a request that never got an answer. */
const NETWORK = 0;

const statusOf = (error: unknown): number | undefined =>
  error instanceof ApiError ? error.status : undefined;

/** Message keys (under `auth.errors`) shared by every auth form. */
export type CommonErrorKey = 'rateLimited' | 'unavailable' | 'network' | 'generic';

function commonErrorKey(error: unknown): CommonErrorKey {
  switch (statusOf(error)) {
    case 429:
      return 'rateLimited';
    case 503:
      return 'unavailable';
    case NETWORK:
      return 'network';
    default:
      return 'generic';
  }
}

export type SignInErrorKey = 'incorrect' | 'paused' | CommonErrorKey;

/**
 * Password sign-in: every wrong-credentials case is one 401; a 429 is either this identifier's
 * pause (`type` ends in `sign-in-paused`, shown with the web's own copy) or the per-network limit.
 */
export function signInErrorKey(error: unknown): SignInErrorKey {
  if (!(error instanceof ApiError)) return 'generic';
  if (error.status === 401) return 'incorrect';
  if (error.status === 429 && error.problem.type.endsWith('sign-in-paused')) return 'paused';
  return commonErrorKey(error);
}

/** "Email me a sign-in code": 202 whether or not the account exists, so only limits and outages. */
export function codeRequestErrorKey(error: unknown): CommonErrorKey {
  return commonErrorKey(error);
}

export type CodeVerifyErrorKey = 'incorrect' | CommonErrorKey;

/** Code verify: one 401 for wrong, expired and used-up codes; a 400 is a code the API refused. */
export function codeVerifyErrorKey(error: unknown): CodeVerifyErrorKey {
  const status = statusOf(error);
  if (status === 401 || status === 400) return 'incorrect';
  return commonErrorKey(error);
}

/** Forgot password: 202 whether or not the account exists, so only limits and outages. */
export function forgotErrorKey(error: unknown): CommonErrorKey {
  return commonErrorKey(error);
}

/** Password policy rules the API reports on `newPassword`, plus `other` for any rule added later. */
export type PolicyKey =
  'too_short' | 'too_long' | 'common' | 'contains_email' | 'contains_school_code' | 'other';

const POLICY_KEYS: ReadonlySet<string> = new Set([
  'too_short',
  'too_long',
  'common',
  'contains_email',
  'contains_school_code',
]);

export type ResetError =
  | { kind: 'invalidLink' }
  | { kind: 'policy'; keys: PolicyKey[] }
  | { kind: 'error'; key: CommonErrorKey };

/**
 * Password reset: 410 is the one answer for an expired, used or unknown link (a malformed token,
 * a 400 on `token`, means the same to the reader); a 400 on `newPassword` lists the failed rules.
 */
export function resetErrorOf(error: unknown): ResetError {
  if (!(error instanceof ApiError)) return { kind: 'error', key: 'generic' };
  if (error.status === 410) return { kind: 'invalidLink' };
  if (error.status === 400) {
    const issues = error.problem.errors ?? [];
    if (issues.some((issue) => issue.path === 'token')) return { kind: 'invalidLink' };
    const password = issues.filter((issue) => issue.path === 'newPassword');
    if (password.length > 0) {
      const keys = password.map((issue) =>
        issue.code && POLICY_KEYS.has(issue.code) ? (issue.code as PolicyKey) : 'other',
      );
      return { kind: 'policy', keys: [...new Set(keys)] };
    }
  }
  return { kind: 'error', key: commonErrorKey(error) };
}
