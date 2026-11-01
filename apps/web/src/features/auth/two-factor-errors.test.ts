import { ApiError } from '@classloom/api-client';
import type { ProblemDetails } from '@classloom/contracts';
import { describe, expect, it } from 'vitest';

import { twoFactorErrorOf } from './two-factor-errors';

const apiError = (status: number, extra: Partial<ProblemDetails> = {}) =>
  new ApiError(status, { type: 'about:blank', title: 'x', status, ...extra });

describe('twoFactorErrorOf', () => {
  it('maps a 401 two-factor-invalid to "invalid" with the tries left', () => {
    expect(
      twoFactorErrorOf(apiError(401, { type: 'two-factor-invalid', attemptsLeft: 3 })),
    ).toEqual({ key: 'invalid', attemptsLeft: 3 });
    expect(
      twoFactorErrorOf(
        apiError(401, {
          type: 'https://classloom.app/problems/two-factor-invalid',
          attemptsLeft: 0,
        }),
      ),
    ).toEqual({ key: 'invalid', attemptsLeft: 0 });
  });

  it('leaves attemptsLeft out when the body has none', () => {
    expect(twoFactorErrorOf(apiError(401, { type: 'two-factor-invalid' }))).toEqual({
      key: 'invalid',
    });
  });

  it('maps a 401 two-factor-expired to "expired"', () => {
    expect(twoFactorErrorOf(apiError(401, { type: 'two-factor-expired' }))).toEqual({
      key: 'expired',
    });
  });

  it('maps a 429 two-factor-paused to "paused"', () => {
    expect(twoFactorErrorOf(apiError(429, { type: 'two-factor-paused', retryAfter: 900 }))).toEqual(
      { key: 'paused' },
    );
  });

  it('maps a 503 to "temporarilyUnavailable"', () => {
    expect(twoFactorErrorOf(apiError(503))).toEqual({ key: 'temporarilyUnavailable' });
  });

  it('maps a request that never got an answer to "network"', () => {
    expect(twoFactorErrorOf(apiError(0))).toEqual({ key: 'network' });
  });

  it('maps anything else to "generic"', () => {
    expect(twoFactorErrorOf(apiError(500))).toEqual({ key: 'generic' });
    expect(twoFactorErrorOf(apiError(401))).toEqual({ key: 'generic' });
    expect(twoFactorErrorOf(apiError(429))).toEqual({ key: 'generic' });
    expect(twoFactorErrorOf(new Error('boom'))).toEqual({ key: 'generic' });
  });
});
