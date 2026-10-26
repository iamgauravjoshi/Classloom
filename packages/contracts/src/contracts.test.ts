import { describe, expect, it } from 'vitest';

import { healthResponseSchema, problemDetailsSchema } from './index';

describe('problemDetailsSchema', () => {
  it('accepts an RFC 7807 body with field errors', () => {
    const body = {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      errors: [{ path: 'email', message: 'Invalid email' }],
    };
    expect(problemDetailsSchema.parse(body)).toEqual(body);
  });

  it('rejects a body without a status', () => {
    expect(problemDetailsSchema.safeParse({ type: 'about:blank', title: 'X' }).success).toBe(false);
  });
});

describe('healthResponseSchema', () => {
  it('accepts the all-up shape', () => {
    const body = { status: 'ok', checks: { database: 'up', redis: 'up' } };
    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects unknown check states', () => {
    expect(
      healthResponseSchema.safeParse({ status: 'ok', checks: { database: 'maybe', redis: 'up' } })
        .success,
    ).toBe(false);
  });
});
