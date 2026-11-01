import { ApiError } from '@classloom/api-client';

import { isRecentSignInRequired } from '../account/recent-sign-in';
import type { CommonErrorKey } from '../auth/auth-errors';

export type SecurityError =
  | { kind: 'recentSignIn' }
  | { kind: 'wrongCode'; field: 'code' | 'recoveryCode' }
  | { kind: 'paused' }
  | { kind: 'setupExpired' }
  | { kind: 'stale' }
  | { kind: 'error'; key: CommonErrorKey };

/**
 * The two-step and session actions on the Security page: a 403 asks for a recent sign-in; a 400 on
 * `code` or `recoveryCode` is a wrong code; 429 `two-factor-paused` is the per-person pause; 410
 * means the setup's secret expired; 409 means two-step was already turned on or off elsewhere.
 */
export function securityErrorOf(error: unknown): SecurityError {
  if (!(error instanceof ApiError)) return { kind: 'error', key: 'generic' };
  if (isRecentSignInRequired(error)) return { kind: 'recentSignIn' };
  const { status, problem } = error;
  if (status === 400) {
    const paths = (problem.errors ?? []).map((issue) => issue.path);
    if (paths.includes('code')) return { kind: 'wrongCode', field: 'code' };
    if (paths.includes('recoveryCode')) return { kind: 'wrongCode', field: 'recoveryCode' };
  }
  if (status === 429 && problem.type.endsWith('two-factor-paused')) return { kind: 'paused' };
  if (status === 410) return { kind: 'setupExpired' };
  if (status === 409) return { kind: 'stale' };
  if (status === 429) return { kind: 'error', key: 'rateLimited' };
  if (status === 503) return { kind: 'error', key: 'temporarilyUnavailable' };
  if (status === 0) return { kind: 'error', key: 'network' };
  return { kind: 'error', key: 'generic' };
}
