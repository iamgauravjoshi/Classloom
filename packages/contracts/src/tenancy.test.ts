import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  BOARDS,
  INDIAN_STATES,
  type IndianStateCode,
  type PublicSchool,
  type SchoolRegistrationRequest,
  schoolRegistrationRequestSchema,
} from './index';

const validPayload = {
  schoolName: 'Green Valley Public School',
  board: 'CBSE',
  city: 'Dehradun',
  state: 'UK',
  code: 'gisd',
  adminName: 'Asha Rawat',
  email: ' Asha@School.IN ',
  mobile: '98765 43210',
  acceptTerms: true,
};

describe('schoolRegistrationRequestSchema', () => {
  it('parses a valid payload and normalises email, code and mobile', () => {
    const parsed = schoolRegistrationRequestSchema.parse(validPayload);
    expect(parsed.email).toBe('asha@school.in');
    expect(parsed.code).toBe('GISD');
    expect(parsed.mobile).toBe('+919876543210');
  });

  it('treats an empty mobile as absent', () => {
    const parsed = schoolRegistrationRequestSchema.parse({ ...validPayload, mobile: '' });
    expect(parsed.mobile).toBeUndefined();
  });

  it('rejects acceptTerms: false at path acceptTerms', () => {
    const result = schoolRegistrationRequestSchema.safeParse({
      ...validPayload,
      acceptTerms: false,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain('acceptTerms');
  });

  it('rejects a reserved school code at path code', () => {
    const result = schoolRegistrationRequestSchema.safeParse({ ...validPayload, code: 'admin' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain('code');
  });

  it('rejects a malformed mobile number', () => {
    const result = schoolRegistrationRequestSchema.safeParse({
      ...validPayload,
      mobile: '12345',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain('mobile');
  });

  it('rejects an email that is actually a mobile number', () => {
    const result = schoolRegistrationRequestSchema.safeParse({
      ...validPayload,
      email: '98765 43210',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain('email');
  });

  it('rejects an unknown state code', () => {
    const result = schoolRegistrationRequestSchema.safeParse({ ...validPayload, state: 'XX' });
    expect(result.success).toBe(false);
  });

  it('rejects a school name shorter than 3 characters after trimming', () => {
    const result = schoolRegistrationRequestSchema.safeParse({
      ...validPayload,
      schoolName: '  ab ',
    });
    expect(result.success).toBe(false);
  });
});

describe('BOARDS', () => {
  it('lists the supported boards', () => {
    expect(BOARDS).toEqual(['CBSE', 'ICSE', 'STATE', 'IB', 'CAMBRIDGE', 'OTHER']);
  });
});

describe('INDIAN_STATES', () => {
  it('has 36 entries (28 states and 8 union territories) with unique codes', () => {
    expect(INDIAN_STATES).toHaveLength(36);
    expect(new Set(INDIAN_STATES.map((s) => s.code)).size).toBe(36);
  });

  it('has exactly the ISO 3166-2:IN codes, sorted', () => {
    const codes = INDIAN_STATES.map((s) => s.code)
      .slice()
      .sort();
    expect(codes).toEqual([
      'AN',
      'AP',
      'AR',
      'AS',
      'BR',
      'CG',
      'CH',
      'DH',
      'DL',
      'GA',
      'GJ',
      'HP',
      'HR',
      'JH',
      'JK',
      'KA',
      'KL',
      'LA',
      'LD',
      'MH',
      'ML',
      'MN',
      'MP',
      'MZ',
      'NL',
      'OD',
      'PB',
      'PY',
      'RJ',
      'SK',
      'TG',
      'TN',
      'TR',
      'UK',
      'UP',
      'WB',
    ]);
  });
});

describe('state type', () => {
  it('keeps the literal union of state codes', () => {
    expectTypeOf<SchoolRegistrationRequest['state']>().toEqualTypeOf<IndianStateCode>();
    expectTypeOf<PublicSchool['state']>().toEqualTypeOf<IndianStateCode>();
  });
});
