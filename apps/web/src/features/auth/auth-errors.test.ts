import { ApiError } from '@classloom/api-client';
import type { ProblemDetails } from '@classloom/contracts';
import { describe, expect, it } from 'vitest';

import {
  codeRequestErrorKey,
  codeVerifyErrorKey,
  forgotErrorKey,
  resetErrorOf,
  signInErrorKey,
} from './auth-errors';

const apiError = (status: number, extra: Partial<ProblemDetails> = {}) =>
  new ApiError(status, { type: 'about:blank', title: 'x', status, ...extra });

describe('signInErrorKey', () => {
  it('maps a 401 to the one "incorrect" answer', () => {
    expect(signInErrorKey(apiError(401))).toBe('incorrect');
  });

  it('maps a 429 sign-in-paused to the pause copy', () => {
    expect(signInErrorKey(apiError(429, { type: 'sign-in-paused', retryAfter: 900 }))).toBe(
      'paused',
    );
    expect(
      signInErrorKey(apiError(429, { type: 'https://classloom.app/problems/sign-in-paused' })),
    ).toBe('paused');
  });

  it('maps any other 429 to the network limit', () => {
    expect(signInErrorKey(apiError(429))).toBe('rateLimited');
  });

  it('maps a failed fetch to the connection copy and the rest to generic', () => {
    expect(signInErrorKey(apiError(0))).toBe('network');
    expect(signInErrorKey(apiError(500))).toBe('generic');
    expect(signInErrorKey(new Error('boom'))).toBe('generic');
  });
});

describe('codeRequestErrorKey', () => {
  it('maps 429 to the network limit and 503 to unavailable', () => {
    expect(codeRequestErrorKey(apiError(429))).toBe('rateLimited');
    expect(codeRequestErrorKey(apiError(503))).toBe('unavailable');
    expect(codeRequestErrorKey(apiError(0))).toBe('network');
    expect(codeRequestErrorKey(apiError(500))).toBe('generic');
  });
});

describe('codeVerifyErrorKey', () => {
  it('maps 401 (and a refused code format) to the one "incorrect or expired" answer', () => {
    expect(codeVerifyErrorKey(apiError(401))).toBe('incorrect');
    expect(codeVerifyErrorKey(apiError(400))).toBe('incorrect');
  });

  it('maps 429 to the network limit, a failed fetch to network, the rest to generic', () => {
    expect(codeVerifyErrorKey(apiError(429))).toBe('rateLimited');
    expect(codeVerifyErrorKey(apiError(0))).toBe('network');
    expect(codeVerifyErrorKey(apiError(500))).toBe('generic');
  });
});

describe('forgotErrorKey', () => {
  it('maps 429, 503, a failed fetch and the rest', () => {
    expect(forgotErrorKey(apiError(429))).toBe('rateLimited');
    expect(forgotErrorKey(apiError(503))).toBe('unavailable');
    expect(forgotErrorKey(apiError(0))).toBe('network');
    expect(forgotErrorKey(apiError(500))).toBe('generic');
  });
});

describe('resetErrorOf', () => {
  it('maps 410 to the expired-or-used view', () => {
    expect(resetErrorOf(apiError(410))).toEqual({ kind: 'invalidLink' });
  });

  it('maps a 400 on the token (malformed link) to the expired-or-used view', () => {
    const error = apiError(400, { errors: [{ path: 'token', message: 'Invalid' }] });
    expect(resetErrorOf(error)).toEqual({ kind: 'invalidLink' });
  });

  it('maps each password policy code to its own message key', () => {
    for (const code of [
      'too_short',
      'too_long',
      'common',
      'contains_email',
      'contains_school_code',
    ]) {
      const error = apiError(400, { errors: [{ path: 'newPassword', code, message: 'x' }] });
      expect(resetErrorOf(error)).toEqual({ kind: 'policy', keys: [code] });
    }
  });

  it('keeps every failed rule, and maps an unknown one to a generic policy message', () => {
    const error = apiError(400, {
      errors: [
        { path: 'newPassword', code: 'common', message: 'x' },
        { path: 'newPassword', code: 'something_new', message: 'x' },
        { path: 'newPassword', message: 'x' },
      ],
    });
    expect(resetErrorOf(error)).toEqual({ kind: 'policy', keys: ['common', 'other'] });
  });

  it('maps everything else to a page-level error', () => {
    expect(resetErrorOf(apiError(429))).toEqual({ kind: 'error', key: 'rateLimited' });
    expect(resetErrorOf(apiError(0))).toEqual({ kind: 'error', key: 'network' });
    expect(resetErrorOf(apiError(500))).toEqual({ kind: 'error', key: 'generic' });
    expect(resetErrorOf(apiError(400))).toEqual({ kind: 'error', key: 'generic' });
  });
});
