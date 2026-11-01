import { ApiError } from '@classloom/api-client';

import { isRecentSignInRequired } from '../account/recent-sign-in';

export type SecurityError =
  | { kind: 'recentSignIn' }
  | { kind: 'wrongCode'; field: 'code' | 'recoveryCode' }
  | { kind: 'paused' }
  | { kind: 'setupExpired' }
  | { kind: 'stale' }
  | { kind: 'error'; key: SecurityErrorKey };

/** Signed-in wording: 429 and 503 have their own copy here (not the sign-in page's). */
export type SecurityErrorKey = 'rateLimited' | 'unavailable' | 'network' | 'generic';

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
  if (status === 503) return { kind: 'error', key: 'unavailable' };
  if (status === 0) return { kind: 'error', key: 'network' };
  return { kind: 'error', key: 'generic' };
}

/** What the Turn on dialog does when starting the setup or enabling fails. */
export type SetupFailureAction = 'reauth' | 'restart' | 'alreadyOn' | 'show';

/**
 * 403: sign in again. 410: the secret expired, start a new setup. 409: two-step is already on
 * (turned on elsewhere), so close the dialog and refresh. Anything else is shown in the dialog.
 */
export function setupFailureAction(error: SecurityError): SetupFailureAction {
  switch (error.kind) {
    case 'recentSignIn':
      return 'reauth';
    case 'setupExpired':
      return 'restart';
    case 'stale':
      return 'alreadyOn';
    default:
      return 'show';
  }
}
