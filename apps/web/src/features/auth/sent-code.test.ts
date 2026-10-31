import { describe, expect, it } from 'vitest';

import { reusableCode, sentCode } from './sent-code';

const NOW = Date.UTC(2026, 9, 31, 10, 0, 0);

describe('sentCode', () => {
  it('expires in 10 minutes and allows a resend after 60 seconds', () => {
    expect(sentCode('GISD', 'a@example.com', 'a***@example.com', NOW)).toEqual({
      schoolCode: 'GISD',
      email: 'a@example.com',
      maskedEmail: 'a***@example.com',
      expiresAt: NOW + 600_000,
      resendAt: NOW + 60_000,
    });
  });
});

describe('reusableCode', () => {
  const last = sentCode('GISD', 'a@example.com', 'a***@example.com', NOW);

  it('reuses the last code for the same school and email within 60 seconds', () => {
    expect(reusableCode(last, 'GISD', 'a@example.com', NOW + 30_000)).toBe(last);
  });

  it('asks for a new code once a resend is allowed', () => {
    expect(reusableCode(last, 'GISD', 'a@example.com', NOW + 60_000)).toBeNull();
  });

  it('asks for a new code for another email or school, or with none sent', () => {
    expect(reusableCode(last, 'GISD', 'b@example.com', NOW + 1_000)).toBeNull();
    expect(reusableCode(last, 'OTHER', 'a@example.com', NOW + 1_000)).toBeNull();
    expect(reusableCode(null, 'GISD', 'a@example.com', NOW + 1_000)).toBeNull();
  });
});
