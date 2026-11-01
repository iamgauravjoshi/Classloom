import { ApiError } from '@classloom/api-client';
import type { ProblemDetails } from '@classloom/contracts';
import { describe, expect, it } from 'vitest';

import { securityErrorOf } from './security-errors';

const apiError = (status: number, extra: Partial<ProblemDetails> = {}) =>
  new ApiError(status, { type: 'about:blank', title: 'x', status, ...extra });

describe('securityErrorOf', () => {
  it('reads a 403 recent-sign-in-required as a reauth', () => {
    expect(securityErrorOf(apiError(403, { type: 'recent-sign-in-required' }))).toEqual({
      kind: 'recentSignIn',
    });
  });

  it('reads a 400 on code or recoveryCode as a wrong code on that field', () => {
    expect(
      securityErrorOf(
        apiError(400, { errors: [{ path: 'code', message: "That code didn't work." }] }),
      ),
    ).toEqual({ kind: 'wrongCode', field: 'code' });
    expect(
      securityErrorOf(
        apiError(400, { errors: [{ path: 'recoveryCode', message: "That code didn't work." }] }),
      ),
    ).toEqual({ kind: 'wrongCode', field: 'recoveryCode' });
  });

  it('reads 429 two-factor-paused as the pause, any other 429 as rate limited', () => {
    expect(securityErrorOf(apiError(429, { type: 'two-factor-paused' }))).toEqual({
      kind: 'paused',
    });
    expect(securityErrorOf(apiError(429))).toEqual({ kind: 'error', key: 'rateLimited' });
  });

  it('reads 410 as an expired setup and 409 as a stale state', () => {
    expect(securityErrorOf(apiError(410))).toEqual({ kind: 'setupExpired' });
    expect(securityErrorOf(apiError(409))).toEqual({ kind: 'stale' });
  });

  it('falls back to the common errors', () => {
    expect(securityErrorOf(apiError(503))).toEqual({
      kind: 'error',
      key: 'temporarilyUnavailable',
    });
    expect(securityErrorOf(apiError(0))).toEqual({ kind: 'error', key: 'network' });
    expect(securityErrorOf(apiError(400))).toEqual({ kind: 'error', key: 'generic' });
    expect(securityErrorOf(apiError(403))).toEqual({ kind: 'error', key: 'generic' });
    expect(securityErrorOf(new Error('boom'))).toEqual({ kind: 'error', key: 'generic' });
  });
});
