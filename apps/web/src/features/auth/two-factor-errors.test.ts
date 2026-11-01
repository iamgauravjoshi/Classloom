import { ApiError } from '@classloom/api-client';
import type { ProblemDetails } from '@classloom/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import messages from '../../../messages/en.json';
import { retryMinutes, twoFactorErrorOf } from './two-factor-errors';

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

  it('maps a 429 two-factor-paused to "paused", carrying retryAfter when the API sends it', () => {
    expect(twoFactorErrorOf(apiError(429, { type: 'two-factor-paused', retryAfter: 900 }))).toEqual(
      { key: 'paused', retryAfter: 900 },
    );
    expect(twoFactorErrorOf(apiError(429, { type: 'two-factor-paused' }))).toEqual({
      key: 'paused',
    });
  });

  it('maps any other 429 (the per-network limit) to "rateLimited"', () => {
    expect(twoFactorErrorOf(apiError(429))).toEqual({ key: 'rateLimited' });
    expect(twoFactorErrorOf(apiError(429, { type: 'sign-in-paused', retryAfter: 60 }))).toEqual({
      key: 'rateLimited',
    });
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
    expect(twoFactorErrorOf(new Error('boom'))).toEqual({ key: 'generic' });
  });
});

describe('retryMinutes', () => {
  it('rounds the wait up to whole minutes, at least one', () => {
    expect(retryMinutes(900)).toBe(15);
    expect(retryMinutes(899)).toBe(15);
    expect(retryMinutes(61)).toBe(2);
    expect(retryMinutes(60)).toBe(1);
    expect(retryMinutes(1)).toBe(1);
    expect(retryMinutes(0)).toBe(1);
  });

  it('is undefined when the API gave no wait', () => {
    expect(retryMinutes(undefined)).toBeUndefined();
  });
});

describe('two-step copy', () => {
  const t = createTranslator({ locale: 'en', messages, namespace: 'auth.signIn.twoFactor' });

  it('says a wrong code and the tries left in one message', () => {
    expect(t('invalidTriesLeft', { count: 1 })).toBe("That code didn't work. 1 try left.");
    expect(t('invalidTriesLeft', { count: 3 })).toBe("That code didn't work. 3 tries left.");
  });

  it('says the last wrong try did not work and that the sign-in has ended', () => {
    expect(t('invalidEnded')).toBe("That code didn't work. This sign-in has expired. Start again.");
  });

  it('gives the actual wait when paused, or no fixed wait when it is unknown', () => {
    expect(t('paused', { minutes: 15 })).toBe('Too many wrong codes. Try again in 15 minutes.');
    expect(t('paused', { minutes: 1 })).toBe('Too many wrong codes. Try again in 1 minute.');
    expect(t('pausedLater')).toBe('Too many wrong codes. Try again later.');
  });

  it('has the recovery-code placeholder', () => {
    expect(t('recoveryPlaceholder')).toBe('XXXXX-XXXXX');
  });
});
