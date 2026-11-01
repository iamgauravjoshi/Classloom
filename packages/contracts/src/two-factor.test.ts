import { describe, expect, it } from 'vitest';

import {
  loginActivityPageSchema,
  mySessionsSchema,
  recoveryCodesSchema,
  twoFactorCodeRequestSchema,
  twoFactorDisableRequestSchema,
  twoFactorVerifyRequestSchema,
} from './index';

const challenge = 'a'.repeat(43);

describe('twoFactorVerifyRequestSchema', () => {
  it('strips spaces from the code', () => {
    const parsed = twoFactorVerifyRequestSchema.parse({
      challenge,
      code: '482 913',
      trustDevice: false,
    });
    expect(parsed.code).toBe('482913');
  });

  it('rejects a code that is not 6 digits', () => {
    expect(
      twoFactorVerifyRequestSchema.safeParse({ challenge, code: '12345', trustDevice: false })
        .success,
    ).toBe(false);
  });

  it('requires exactly one of code and recoveryCode', () => {
    const base = { challenge, trustDevice: true };
    expect(twoFactorVerifyRequestSchema.safeParse(base).success).toBe(false);
    expect(
      twoFactorVerifyRequestSchema.safeParse({
        ...base,
        code: '123456',
        recoveryCode: 'ABCDE-FGHJK',
      }).success,
    ).toBe(false);
    expect(
      twoFactorVerifyRequestSchema.safeParse({ ...base, recoveryCode: ' ABCDE-FGHJK ' }).data
        ?.recoveryCode,
    ).toBe('ABCDE-FGHJK');
  });

  it('caps the recovery code at 20 characters', () => {
    expect(
      twoFactorVerifyRequestSchema.safeParse({
        challenge,
        recoveryCode: 'A'.repeat(21),
        trustDevice: false,
      }).success,
    ).toBe(false);
  });
});

describe('twoFactorDisableRequestSchema', () => {
  it('requires exactly one of code and recoveryCode', () => {
    expect(twoFactorDisableRequestSchema.safeParse({}).success).toBe(false);
    expect(
      twoFactorDisableRequestSchema.safeParse({ code: '123456', recoveryCode: 'ABCDE-FGHJK' })
        .success,
    ).toBe(false);
    expect(twoFactorDisableRequestSchema.safeParse({ code: '123 456' }).data).toEqual({
      code: '123456',
    });
  });
});

describe('twoFactorCodeRequestSchema', () => {
  it('normalises the code', () => {
    expect(twoFactorCodeRequestSchema.parse({ code: '123 456' })).toEqual({ code: '123456' });
  });
});

describe('recoveryCodesSchema', () => {
  it('needs exactly 10 codes', () => {
    const codes = Array.from({ length: 10 }, (_, i) => `ABCDE-FGH${i}K`);
    expect(recoveryCodesSchema.safeParse({ recoveryCodes: codes }).success).toBe(true);
    expect(recoveryCodesSchema.safeParse({ recoveryCodes: codes.slice(0, 9) }).success).toBe(false);
  });
});

describe('list schemas', () => {
  it('accepts a session list row', () => {
    const row = {
      id: 'x',
      current: true,
      school: { code: 'ABC', name: 'ABC School' },
      device: 'Chrome on Windows',
      ip: null,
      signedInAt: '2026-11-01T10:00:00.000Z',
      lastSeenAt: '2026-11-01T10:05:00.000Z',
      remember: false,
    };
    expect(mySessionsSchema.parse({ sessions: [row] }).sessions[0]).toEqual(row);
  });

  it('accepts a login activity page', () => {
    const page = {
      events: [
        {
          id: 'e1',
          type: 'SIGN_IN_SUCCEEDED',
          method: 'PASSWORD',
          school: null,
          device: 'Chrome on Windows',
          ip: '1.2.3.4',
          at: '2026-11-01T10:00:00.000Z',
        },
      ],
      nextCursor: null,
    };
    expect(loginActivityPageSchema.parse(page)).toEqual(page);
  });
});
