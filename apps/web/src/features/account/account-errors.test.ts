import { ApiError } from '@classloom/api-client';
import type { ProblemDetails } from '@classloom/contracts';
import { describe, expect, it } from 'vitest';

import { passwordErrorOf, profileErrorOf } from './account-errors';

const apiError = (status: number, extra: Partial<ProblemDetails> = {}) =>
  new ApiError(status, { type: 'about:blank', title: 'x', status, ...extra });

describe('profileErrorOf', () => {
  it('puts a 409 on the mobile field as "taken"', () => {
    expect(profileErrorOf(apiError(409, { errors: [{ path: 'mobile', message: 'm' }] }))).toEqual({
      kind: 'field',
      field: 'mobile',
      key: 'mobileTaken',
    });
  });

  it('puts a 400 on the fields it names', () => {
    expect(
      profileErrorOf(
        apiError(400, {
          errors: [
            { path: 'name', message: 'm' },
            { path: 'mobile', message: 'm' },
          ],
        }),
      ),
    ).toEqual({ kind: 'fields', fields: ['name', 'mobile'] });
  });

  it('maps a 429 to its own copy and the rest to the common keys', () => {
    expect(profileErrorOf(apiError(429))).toEqual({ kind: 'error', key: 'rateLimited' });
    expect(profileErrorOf(apiError(503))).toEqual({ kind: 'error', key: 'temporarilyUnavailable' });
    expect(profileErrorOf(apiError(0))).toEqual({ kind: 'error', key: 'network' });
    expect(profileErrorOf(apiError(409))).toEqual({ kind: 'error', key: 'generic' });
    expect(profileErrorOf(new Error('x'))).toEqual({ kind: 'error', key: 'generic' });
  });
});

describe('passwordErrorOf', () => {
  it('marks a wrong current password', () => {
    expect(
      passwordErrorOf(apiError(400, { errors: [{ path: 'currentPassword', message: 'm' }] })),
    ).toEqual({
      kind: 'currentWrong',
    });
  });

  it('lists the failed policy rules, once each', () => {
    expect(
      passwordErrorOf(
        apiError(400, {
          errors: [
            { path: 'newPassword', message: 'm', code: 'common' },
            { path: 'newPassword', message: 'm', code: 'common' },
            { path: 'newPassword', message: 'm', code: 'brand_new_rule' },
          ],
        }),
      ),
    ).toEqual({ kind: 'policy', keys: ['common', 'other'] });
  });

  it('asks for a recent sign-in on that 403', () => {
    expect(passwordErrorOf(apiError(403, { type: 'recent-sign-in-required' }))).toEqual({
      kind: 'recentSignIn',
    });
  });

  it('tells a paused account from a rate-limited network', () => {
    expect(passwordErrorOf(apiError(429, { type: 'sign-in-paused' }))).toEqual({ kind: 'paused' });
    expect(passwordErrorOf(apiError(429))).toEqual({ kind: 'error', key: 'rateLimited' });
  });

  it('maps outages and the rest to the common keys', () => {
    expect(passwordErrorOf(apiError(503))).toEqual({
      kind: 'error',
      key: 'temporarilyUnavailable',
    });
    expect(passwordErrorOf(apiError(0))).toEqual({ kind: 'error', key: 'network' });
    expect(passwordErrorOf(apiError(403))).toEqual({ kind: 'error', key: 'generic' });
    expect(passwordErrorOf(undefined)).toEqual({ kind: 'error', key: 'generic' });
  });
});
