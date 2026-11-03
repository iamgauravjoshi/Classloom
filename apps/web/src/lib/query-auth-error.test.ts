import { ApiError } from '@classloom/api-client';
import { describe, expect, it, vi } from 'vitest';

import { onQueryError, retryQuery } from './query-auth-error';

const problem = (status: number) => ({ type: 'about:blank', title: 'x', status });

describe('onQueryError', () => {
  const router = () => ({ replace: vi.fn() });

  it('redirects to sign-in with next on a 401', () => {
    const r = router();
    onQueryError(new ApiError(401, problem(401)), r, '/en/students?q=1');
    expect(r.replace).toHaveBeenCalledWith('/en/sign-in?next=%2Fen%2Fstudents%3Fq%3D1');
  });

  it('ignores other API errors and non-API errors', () => {
    const r = router();
    onQueryError(new ApiError(403, problem(403)), r, '/en/students');
    onQueryError(new ApiError(500, problem(500)), r, '/en/students');
    onQueryError(new Error('boom'), r, '/en/students');
    expect(r.replace).not.toHaveBeenCalled();
  });

  it('does not redirect from a public page (a wrong password is a 401 too)', () => {
    const r = router();
    onQueryError(new ApiError(401, problem(401)), r, '/en/sign-in?school=GISD');
    onQueryError(new ApiError(401, problem(401)), r, '/en/register-school');
    expect(r.replace).not.toHaveBeenCalled();
  });
});

describe('onQueryError for required two-step', () => {
  const required = new ApiError(403, {
    type: 'https://classloom.dev/problems/two-factor-setup-required',
    title: 'x',
    status: 403,
  });

  it('sends a session that was flagged mid-visit to the setup page, coming back afterwards', () => {
    const replace = vi.fn();
    onQueryError(required, { replace }, '/en/students?q=1');
    expect(replace).toHaveBeenCalledWith('/en/setup-two-factor?next=%2Fen%2Fstudents%3Fq%3D1');
  });

  it('stays put on the setup page and on public pages', () => {
    const replace = vi.fn();
    onQueryError(required, { replace }, '/en/setup-two-factor?next=%2Fen%2Fdashboard');
    onQueryError(required, { replace }, '/en/sign-in');
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('retryQuery', () => {
  it('retries other failures once', () => {
    expect(retryQuery(0, new ApiError(500, problem(500)))).toBe(true);
    expect(retryQuery(1, new ApiError(500, problem(500)))).toBe(false);
  });

  it('never retries a 401: the session has ended', () => {
    expect(retryQuery(0, new ApiError(401, problem(401)))).toBe(false);
  });
});
