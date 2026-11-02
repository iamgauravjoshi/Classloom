import { ApiError, type AuthSessionDto, type TwoFactorChallengeDto } from '@classloom/api-client';

export type JoinErrorKey = 'rateLimited' | 'temporarilyUnavailable' | 'network' | 'generic';

function commonKey(error: unknown): JoinErrorKey {
  if (!(error instanceof ApiError)) return 'generic';
  switch (error.status) {
    case 429:
      return 'rateLimited';
    case 503:
      return 'temporarilyUnavailable';
    case 0:
      return 'network';
    default:
      return 'generic';
  }
}

/** The preview: 410 is a link that is expired, used, revoked or unknown (one answer for all). */
export function previewErrorKey(error: unknown): 'gone' | JoinErrorKey {
  return error instanceof ApiError && error.status === 410 ? 'gone' : commonKey(error);
}

export type AcceptOutcome =
  { kind: 'gone' } | { kind: 'alreadyMember' } | { kind: 'error'; key: JoinErrorKey };

/** Accept: 410 as above; 409 `already-member` means the person already belongs to the school. */
export function acceptOutcomeOf(error: unknown): AcceptOutcome {
  if (error instanceof ApiError) {
    if (error.status === 410) return { kind: 'gone' };
    if (error.status === 409 && error.problem.type.endsWith('already-member')) {
      return { kind: 'alreadyMember' };
    }
  }
  return { kind: 'error', key: commonKey(error) };
}

/** What a successful accept (200 or 202) leads to: the welcome, or the two-step code step. */
export type AcceptResult =
  { kind: 'signedIn' } | { kind: 'challenge'; challenge: string; expiresAt: number };

export function acceptResultOf(result: AuthSessionDto | TwoFactorChallengeDto): AcceptResult {
  if ('twoFactorRequired' in result) {
    return {
      kind: 'challenge',
      challenge: result.challenge,
      expiresAt: Date.parse(result.expiresAt),
    };
  }
  return { kind: 'signedIn' };
}
