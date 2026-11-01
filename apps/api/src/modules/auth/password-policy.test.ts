import { describe, expect, it } from 'vitest';

import { checkPasswordPolicy } from './password-policy';

const ctx = { email: 'anita@x.in', schoolCodes: ['GISD'] };

describe('checkPasswordPolicy', () => {
  it('flags common passwords case-insensitively, including digit suffixes', () => {
    expect(checkPasswordPolicy('password1234', ctx)).toEqual(['common']);
    expect(checkPasswordPolicy('Password1234', ctx)).toEqual(['common']);
    expect(checkPasswordPolicy('qwertyuiop', ctx)).toEqual(['common']);
  });

  it('flags a password containing the email local part', () => {
    expect(checkPasswordPolicy('anita-secret-99', ctx)).toEqual(['contains_email']);
  });

  it('ignores short email local parts', () => {
    expect(checkPasswordPolicy('xx abc yy zz qq', { ...ctx, email: 'abc@x.in' })).toEqual([]);
  });

  it('flags a password containing a school code', () => {
    expect(checkPasswordPolicy('my gisd password', ctx)).toEqual(['contains_school_code']);
  });

  it('flags length problems', () => {
    expect(checkPasswordPolicy('zq9x', ctx)).toEqual(['too_short']);
    expect(checkPasswordPolicy('x'.repeat(129), ctx)).toEqual(['too_long']);
  });

  it('does not choke on huge input', () => {
    expect(checkPasswordPolicy('x'.repeat(5_000_000), ctx)).toEqual(['too_long']);
  });

  it('accepts a strong passphrase', () => {
    expect(checkPasswordPolicy('violet tractor mango 42 lantern', ctx)).toEqual([]);
  });
});
