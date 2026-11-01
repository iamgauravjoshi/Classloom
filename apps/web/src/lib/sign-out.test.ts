import { ApiError } from '@classloom/api-client';
import { describe, expect, it } from 'vitest';

import { leavesAfterSignOut } from './sign-out';

const apiError = (status: number) =>
  new ApiError(status, { type: 'about:blank', title: 'x', status });

describe('leavesAfterSignOut', () => {
  it('leaves after a successful sign-out', () => {
    expect(leavesAfterSignOut(null)).toBe(true);
  });

  it('leaves after a 401: the session had already ended', () => {
    expect(leavesAfterSignOut(apiError(401))).toBe(true);
  });

  it('stays when the session may still be live (server or network error)', () => {
    expect(leavesAfterSignOut(apiError(500))).toBe(false);
    expect(leavesAfterSignOut(apiError(0))).toBe(false);
    expect(leavesAfterSignOut(apiError(403))).toBe(false);
    expect(leavesAfterSignOut(new Error('boom'))).toBe(false);
  });
});
