import { ApiError } from '@classloom/api-client';
import type { ProblemDetails } from '@classloom/contracts';
import { describe, expect, it } from 'vitest';

import { fieldErrorPaths, iamErrorOf, isStale } from './iam-errors';

const apiError = (status: number, extra: Partial<ProblemDetails> = {}) =>
  new ApiError(status, { type: 'about:blank', title: 'x', status, ...extra });

describe('iamErrorOf', () => {
  it('reads the 409 problem types', () => {
    expect(iamErrorOf(apiError(409, { type: 'last-owner' }))).toBe('lastOwner');
    expect(iamErrorOf(apiError(409, { type: 'already-member' }))).toBe('alreadyMember');
    expect(iamErrorOf(apiError(409, { type: 'already-invited' }))).toBe('alreadyInvited');
    expect(iamErrorOf(apiError(409, { type: 'two-factor-off' }))).toBe('twoFactorOff');
  });

  it('reads the 403 problem types', () => {
    expect(iamErrorOf(apiError(403, { type: 'permission-denied' }))).toBe('permissionDenied');
    expect(iamErrorOf(apiError(403, { type: 'recent-sign-in-required' }))).toBe('recentSignIn');
  });

  it('matches a type that is a full address', () => {
    expect(iamErrorOf(apiError(409, { type: 'https://classloom.dev/problems/last-owner' }))).toBe(
      'lastOwner',
    );
  });

  it('maps a 429 to rate limited', () => {
    expect(iamErrorOf(apiError(429))).toBe('rateLimited');
  });

  it('answers generic for everything else', () => {
    expect(iamErrorOf(apiError(409))).toBe('generic');
    expect(iamErrorOf(apiError(403))).toBe('generic');
    expect(iamErrorOf(apiError(400))).toBe('generic');
    expect(iamErrorOf(apiError(503))).toBe('generic');
    expect(iamErrorOf(apiError(0))).toBe('generic');
    expect(iamErrorOf(new Error('x'))).toBe('generic');
    expect(iamErrorOf(undefined)).toBe('generic');
  });

  it('does not take a type for its status: a 400 named last-owner is still generic', () => {
    expect(iamErrorOf(apiError(400, { type: 'last-owner' }))).toBe('generic');
  });
});

describe('fieldErrorPaths', () => {
  it('lists the fields a 400 names, once each', () => {
    expect(
      fieldErrorPaths(
        apiError(400, {
          errors: [
            { path: 'email', message: 'm' },
            { path: 'email', message: 'm' },
            { path: 'roleIds', message: 'm' },
          ],
        }),
      ),
    ).toEqual(['email', 'roleIds']);
  });

  it('is empty for other errors', () => {
    expect(fieldErrorPaths(apiError(409, { errors: [{ path: 'email', message: 'm' }] }))).toEqual(
      [],
    );
    expect(fieldErrorPaths(new Error('x'))).toEqual([]);
  });
});

describe('isStale', () => {
  it('is true for a 404 and a 409 only', () => {
    expect(isStale(apiError(404))).toBe(true);
    expect(isStale(apiError(409, { type: 'last-owner' }))).toBe(true);
    expect(isStale(apiError(403))).toBe(false);
    expect(isStale(apiError(429))).toBe(false);
    expect(isStale(new Error('x'))).toBe(false);
  });
});
