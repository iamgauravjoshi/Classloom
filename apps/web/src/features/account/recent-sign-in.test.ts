import { ApiError } from '@classloom/api-client';
import type { ProblemDetails } from '@classloom/contracts';
import { describe, expect, it } from 'vitest';

import { isRecentSignInRequired, reauthPath } from './recent-sign-in';

const apiError = (status: number, extra: Partial<ProblemDetails> = {}) =>
  new ApiError(status, { type: 'about:blank', title: 'x', status, ...extra });

describe('isRecentSignInRequired', () => {
  it('is true for a 403 whose type ends in recent-sign-in-required', () => {
    expect(isRecentSignInRequired(apiError(403, { type: 'recent-sign-in-required' }))).toBe(true);
    expect(
      isRecentSignInRequired(
        apiError(403, { type: 'https://classloom.app/problems/recent-sign-in-required' }),
      ),
    ).toBe(true);
  });

  it('is false for any other 403, status or error', () => {
    expect(isRecentSignInRequired(apiError(403))).toBe(false);
    expect(isRecentSignInRequired(apiError(403, { type: 'forbidden' }))).toBe(false);
    expect(isRecentSignInRequired(apiError(401, { type: 'recent-sign-in-required' }))).toBe(false);
    expect(isRecentSignInRequired(apiError(429, { type: 'sign-in-paused' }))).toBe(false);
    expect(isRecentSignInRequired(new Error('recent-sign-in-required'))).toBe(false);
    expect(isRecentSignInRequired(undefined)).toBe(false);
  });
});

describe('reauthPath', () => {
  it('goes to sign-in for the school, coming back to the account page', () => {
    expect(reauthPath('en', 'GISD')).toBe('/en/sign-in?school=GISD&next=%2Fen%2Faccount&reauth=1');
  });

  it('comes back to another account page when given one', () => {
    expect(reauthPath('en', 'GISD', '/en/account/security')).toBe(
      '/en/sign-in?school=GISD&next=%2Fen%2Faccount%2Fsecurity&reauth=1',
    );
  });

  it('encodes the school code', () => {
    expect(reauthPath('en', 'A B')).toBe('/en/sign-in?school=A%20B&next=%2Fen%2Faccount&reauth=1');
  });
});
