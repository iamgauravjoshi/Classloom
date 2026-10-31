import { ApiError } from '@classloom/api-client';

import { type CommonErrorKey, type PolicyKey, resetErrorOf } from '../auth/auth-errors';
import { isRecentSignInRequired } from './recent-sign-in';

const NETWORK = 0;

type ProfileField = 'name' | 'mobile';

export type ProfileError =
  | { kind: 'field'; field: 'mobile'; key: 'mobileTaken' }
  | { kind: 'fields'; fields: ProfileField[] }
  | { kind: 'error'; key: CommonErrorKey };

const isProfileField = (path: string | undefined): path is ProfileField =>
  path === 'name' || path === 'mobile';

/**
 * `PATCH /me`: 409 means another account has that mobile; a 400 names the fields it refused;
 * a 429 is the 20-changes-an-hour limit.
 */
export function profileErrorOf(error: unknown): ProfileError {
  if (!(error instanceof ApiError)) return { kind: 'error', key: 'generic' };
  const paths = (error.problem.errors ?? []).map((issue) => issue.path);
  if (error.status === 409 && paths.includes('mobile')) {
    return { kind: 'field', field: 'mobile', key: 'mobileTaken' };
  }
  if (error.status === 400) {
    const fields = [...new Set(paths.filter(isProfileField))];
    if (fields.length > 0) return { kind: 'fields', fields };
  }
  return { kind: 'error', key: commonKey(error.status) };
}

function commonKey(status: number): CommonErrorKey {
  if (status === 429) return 'rateLimited';
  if (status === 503) return 'temporarilyUnavailable';
  if (status === NETWORK) return 'network';
  return 'generic';
}

export type PasswordError =
  | { kind: 'currentWrong' }
  | { kind: 'policy'; keys: PolicyKey[] }
  | { kind: 'recentSignIn' }
  | { kind: 'paused' }
  | { kind: 'error'; key: CommonErrorKey };

/**
 * `PUT /me/password`: a 400 on `currentPassword` is a wrong one; a 400 on `newPassword` lists the
 * failed rules (read the same way as on the reset page); a 403 asks for a recent sign-in; a 429
 * `sign-in-paused` is the pause the 5th wrong current password starts.
 */
export function passwordErrorOf(error: unknown): PasswordError {
  if (!(error instanceof ApiError)) return { kind: 'error', key: 'generic' };
  if (isRecentSignInRequired(error)) return { kind: 'recentSignIn' };
  const paths = (error.problem.errors ?? []).map((issue) => issue.path);
  if (error.status === 400 && paths.includes('currentPassword')) return { kind: 'currentWrong' };
  if (error.status === 429 && error.problem.type.endsWith('sign-in-paused')) {
    return { kind: 'paused' };
  }
  const outcome = resetErrorOf(error);
  if (outcome.kind === 'policy') return outcome;
  return { kind: 'error', key: commonKey(error.status) };
}
