import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type AuthSession,
  authSessionSchema,
  codeRequestAcceptedSchema,
  codeRequestSchema,
  codeVerifyRequestSchema,
  forgotPasswordRequestSchema,
  type Me,
  type MembershipRoleName,
  meSchema,
  passwordSchema,
  passwordSignInRequestSchema,
  resetPasswordRequestSchema,
  setPasswordRequestSchema,
  updateMeRequestSchema,
} from './index';

describe('passwordSchema', () => {
  it('rejects 9 and 129 characters and accepts 10, 128 and spaces', () => {
    expect(passwordSchema.safeParse('a'.repeat(9)).success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(10)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(128)).success).toBe(true);
    expect(passwordSchema.parse('correct horse 10')).toBe('correct horse 10');
  });

  it('does not trim or otherwise change the password', () => {
    expect(passwordSchema.parse('  spaced out  ')).toBe('  spaced out  ');
  });
});

describe('passwordSignInRequestSchema', () => {
  it('normalises the school code and the identifier', () => {
    expect(
      passwordSignInRequestSchema.parse({
        schoolCode: ' gisd ',
        identifier: ' Anita@Example.COM ',
        password: 'whatever',
        remember: true,
      }),
    ).toEqual({
      schoolCode: 'GISD',
      identifier: 'anita@example.com',
      password: 'whatever',
      remember: true,
    });
  });

  it('accepts an Indian mobile number and returns E.164', () => {
    const parsed = passwordSignInRequestSchema.parse({
      schoolCode: 'GISD',
      identifier: '98765 43210',
      password: 'whatever',
      remember: false,
    });
    expect(parsed.identifier).toBe('+919876543210');
  });

  it('rejects an identifier that is neither email nor mobile, and an empty password', () => {
    const base = { schoolCode: 'GISD', password: 'x', remember: true };
    expect(passwordSignInRequestSchema.safeParse({ ...base, identifier: 'nope' }).success).toBe(
      false,
    );
    expect(
      passwordSignInRequestSchema.safeParse({ ...base, identifier: 'a@b.co', password: '' })
        .success,
    ).toBe(false);
  });

  it('does not enforce the password policy when signing in', () => {
    expect(
      passwordSignInRequestSchema.safeParse({
        schoolCode: 'GISD',
        identifier: 'a@b.co',
        password: 'short',
        remember: true,
      }).success,
    ).toBe(true);
  });
});

describe('codeRequestSchema', () => {
  it('normalises school code and email', () => {
    expect(codeRequestSchema.parse({ schoolCode: 'gisd', email: ' A@B.CO ' })).toEqual({
      schoolCode: 'GISD',
      email: 'a@b.co',
    });
  });

  it('rejects a mobile number in the email field', () => {
    expect(codeRequestSchema.safeParse({ schoolCode: 'GISD', email: '9876543210' }).success).toBe(
      false,
    );
  });

  it('rejects an empty school code', () => {
    expect(codeRequestSchema.safeParse({ schoolCode: '  ', email: 'a@b.co' }).success).toBe(false);
  });
});

describe('codeRequestAcceptedSchema', () => {
  it('carries the masked email', () => {
    expect(codeRequestAcceptedSchema.parse({ maskedEmail: 'a…@example.com' })).toEqual({
      maskedEmail: 'a…@example.com',
    });
  });
});

describe('codeVerifyRequestSchema', () => {
  const base = { schoolCode: 'gisd', email: 'a@b.co', remember: true };

  it('strips spaces from the code', () => {
    expect(codeVerifyRequestSchema.parse({ ...base, code: '482 913' }).code).toBe('482913');
    expect(codeVerifyRequestSchema.parse({ ...base, code: ' 482913 ' }).code).toBe('482913');
  });

  it('rejects a non-numeric or wrong-length code', () => {
    expect(codeVerifyRequestSchema.safeParse({ ...base, code: '48291a' }).success).toBe(false);
    expect(codeVerifyRequestSchema.safeParse({ ...base, code: '48291' }).success).toBe(false);
    expect(codeVerifyRequestSchema.safeParse({ ...base, code: '4829131' }).success).toBe(false);
  });

  it('normalises school code and email', () => {
    const parsed = codeVerifyRequestSchema.parse({ ...base, email: 'A@B.CO', code: '123456' });
    expect(parsed.schoolCode).toBe('GISD');
    expect(parsed.email).toBe('a@b.co');
  });
});

describe('authSessionSchema', () => {
  const session = {
    user: {
      id: 'u1',
      name: 'Anita Sharma',
      email: 'anita@example.com',
      mobile: '+919876543210',
      hasPassword: true,
    },
    school: { id: 's1', code: 'GISD', name: 'Global International School' },
    campus: { id: 'c1', name: 'Global International School' },
    role: 'OWNER',
    remember: true,
    expiresAt: '2026-11-26T08:42:00.000Z',
  };

  it('parses the documented session and allows a null mobile', () => {
    expect(authSessionSchema.parse(session)).toEqual(session);
    expect(
      authSessionSchema.safeParse({ ...session, user: { ...session.user, mobile: null } }).success,
    ).toBe(true);
  });

  it('rejects other roles and a non-ISO expiry', () => {
    expect(authSessionSchema.safeParse({ ...session, role: 'TEACHER' }).success).toBe(false);
    expect(authSessionSchema.safeParse({ ...session, expiresAt: 'tomorrow' }).success).toBe(false);
  });

  it('exposes the inferred types', () => {
    expectTypeOf<AuthSession['role']>().toEqualTypeOf<'OWNER'>();
    expectTypeOf<AuthSession['user']['mobile']>().toEqualTypeOf<string | null>();
    expectTypeOf<MembershipRoleName>().toEqualTypeOf<'OWNER'>();
  });
});

describe('forgotPasswordRequestSchema', () => {
  it('accepts an email or a mobile and normalises it', () => {
    expect(forgotPasswordRequestSchema.parse({ identifier: ' A@B.CO ' }).identifier).toBe('a@b.co');
    expect(forgotPasswordRequestSchema.parse({ identifier: '9876543210' }).identifier).toBe(
      '+919876543210',
    );
    expect(forgotPasswordRequestSchema.safeParse({ identifier: 'nope' }).success).toBe(false);
  });
});

describe('resetPasswordRequestSchema', () => {
  const token = 'A'.repeat(43);

  it('requires a 43-character token and a policy-conforming password', () => {
    expect(
      resetPasswordRequestSchema.safeParse({ token, newPassword: 'correct horse 10' }).success,
    ).toBe(true);
    expect(
      resetPasswordRequestSchema.safeParse({ token: 'short', newPassword: 'correct horse 10' })
        .success,
    ).toBe(false);
    expect(resetPasswordRequestSchema.safeParse({ token, newPassword: 'short' }).success).toBe(
      false,
    );
  });
});

describe('meSchema', () => {
  it('has the documented shape', () => {
    const me = {
      id: 'u1',
      name: 'Anita',
      email: 'a@b.co',
      emailVerified: true,
      mobile: null,
      hasPassword: false,
    };
    expect(meSchema.parse(me)).toEqual(me);
    expectTypeOf<Me>().toEqualTypeOf<{
      id: string;
      name: string;
      email: string;
      emailVerified: boolean;
      mobile: string | null;
      hasPassword: boolean;
    }>();
  });
});

describe('updateMeRequestSchema', () => {
  it('maps a written mobile to E.164 and keeps null', () => {
    expect(updateMeRequestSchema.parse({ mobile: '98765 43210' }).mobile).toBe('+919876543210');
    expect(updateMeRequestSchema.parse({ mobile: null }).mobile).toBeNull();
  });

  it('allows leaving fields out, and trims the name', () => {
    expect(updateMeRequestSchema.parse({})).toEqual({});
    expect(updateMeRequestSchema.parse({ name: '  Anita Sharma ' }).name).toBe('Anita Sharma');
  });

  it('rejects a bad mobile and a name outside 2 to 80 characters', () => {
    expect(updateMeRequestSchema.safeParse({ mobile: '12345' }).success).toBe(false);
    expect(updateMeRequestSchema.safeParse({ name: 'A' }).success).toBe(false);
    expect(updateMeRequestSchema.safeParse({ name: 'A'.repeat(81) }).success).toBe(false);
  });
});

describe('setPasswordRequestSchema', () => {
  it('makes the current password optional and enforces the policy on the new one', () => {
    expect(setPasswordRequestSchema.safeParse({ newPassword: 'correct horse 10' }).success).toBe(
      true,
    );
    expect(
      setPasswordRequestSchema.safeParse({
        currentPassword: 'old',
        newPassword: 'correct horse 10',
      }).success,
    ).toBe(true);
    expect(setPasswordRequestSchema.safeParse({ newPassword: 'short' }).success).toBe(false);
  });
});
