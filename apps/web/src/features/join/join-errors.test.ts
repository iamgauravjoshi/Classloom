import { ApiError } from '@classloom/api-client';
import { describe, expect, it } from 'vitest';

import { acceptOutcomeOf, acceptResultOf, previewErrorKey } from './join-errors';

const problem = (status: number, type = 'about:blank') =>
  new ApiError(status, { type, title: 't', status });

describe('previewErrorKey', () => {
  it('maps 410 to a link that is no longer usable', () => {
    expect(previewErrorKey(problem(410))).toBe('gone');
  });

  it('maps limits and outages', () => {
    expect(previewErrorKey(problem(429))).toBe('rateLimited');
    expect(previewErrorKey(problem(503))).toBe('temporarilyUnavailable');
    expect(previewErrorKey(problem(0))).toBe('network');
    expect(previewErrorKey(new Error('x'))).toBe('generic');
  });
});

describe('acceptOutcomeOf', () => {
  it('maps 410 to gone', () => {
    expect(acceptOutcomeOf(problem(410))).toEqual({ kind: 'gone' });
  });

  it('maps 409 already-member', () => {
    expect(acceptOutcomeOf(problem(409, '/problems/already-member'))).toEqual({
      kind: 'alreadyMember',
    });
  });

  it('treats another 409 as a generic failure', () => {
    expect(acceptOutcomeOf(problem(409, '/problems/other'))).toEqual({
      kind: 'error',
      key: 'generic',
    });
  });

  it('maps limits and outages', () => {
    expect(acceptOutcomeOf(problem(429))).toEqual({ kind: 'error', key: 'rateLimited' });
    expect(acceptOutcomeOf(problem(503))).toEqual({
      kind: 'error',
      key: 'temporarilyUnavailable',
    });
    expect(acceptOutcomeOf(problem(0))).toEqual({ kind: 'error', key: 'network' });
  });
});

describe('acceptResultOf', () => {
  it('maps a 202 two-step challenge to the code step, with the expiry in milliseconds', () => {
    expect(
      acceptResultOf({
        twoFactorRequired: true,
        challenge: 'abc',
        expiresAt: '2026-11-02T10:00:00.000Z',
      }),
    ).toEqual({
      kind: 'challenge',
      challenge: 'abc',
      expiresAt: Date.parse('2026-11-02T10:00:00.000Z'),
    });
  });

  it('maps a 200 session to signed in', () => {
    const session = { user: { id: 'u' }, permissions: [] } as never;
    expect(acceptResultOf(session)).toEqual({ kind: 'signedIn' });
  });
});
