import { ApiError } from '@classloom/api-client';

export type TwoFactorErrorKey =
  | 'invalid'
  | 'expired'
  | 'paused'
  | 'rateLimited'
  | 'temporarilyUnavailable'
  | 'network'
  | 'generic';

export interface TwoFactorError {
  key: TwoFactorErrorKey;
  /** On `invalid`: tries left on this sign-in, when the API says. */
  attemptsLeft?: number;
  /** On `paused`: seconds until codes are accepted again, when the API says. */
  retryAfter?: number;
}

/**
 * Two-step verify: 401 `two-factor-invalid` is a wrong code (with the tries left), 401
 * `two-factor-expired` a challenge that is gone (expired, used up, or no longer valid), 429
 * `two-factor-paused` the per-person pause (any other 429 is the per-network limit); a 503 means
 * the API's Redis is down.
 */
export function twoFactorErrorOf(error: unknown): TwoFactorError {
  if (!(error instanceof ApiError)) return { key: 'generic' };
  const { status, problem } = error;
  if (status === 401 && problem.type.endsWith('two-factor-invalid')) {
    return problem.attemptsLeft === undefined
      ? { key: 'invalid' }
      : { key: 'invalid', attemptsLeft: problem.attemptsLeft };
  }
  if (status === 401 && problem.type.endsWith('two-factor-expired')) return { key: 'expired' };
  if (status === 429 && problem.type.endsWith('two-factor-paused')) {
    return problem.retryAfter === undefined
      ? { key: 'paused' }
      : { key: 'paused', retryAfter: problem.retryAfter };
  }
  if (status === 429) return { key: 'rateLimited' };
  if (status === 503) return { key: 'temporarilyUnavailable' };
  if (status === 0) return { key: 'network' };
  return { key: 'generic' };
}

/** A `retryAfter` in seconds as whole minutes to wait, rounded up (at least 1). */
export function retryMinutes(seconds: number | undefined): number | undefined {
  if (seconds === undefined) return undefined;
  return Math.max(1, Math.ceil(seconds / 60));
}
