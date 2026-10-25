import { describe, expect, it } from 'vitest';

import { normalizeIndianMobile, parseIdentifier } from './identifiers';

describe('parseIdentifier', () => {
  it.each([
    '+91 98765 43210',
    '098765-43210',
    '919876543210',
    '98765 43210',
    '9876543210',
    '(+91) 98765-43210',
  ])('normalises mobile %s to E.164', (raw) => {
    expect(parseIdentifier(raw)).toEqual({ kind: 'mobile', value: '+919876543210' });
  });

  it('trims and lowercases emails', () => {
    expect(parseIdentifier('  Priya.Sharma@Gmail.COM ')).toEqual({
      kind: 'email',
      value: 'priya.sharma@gmail.com',
    });
  });

  it('rejects too-short numbers', () => {
    expect(parseIdentifier('12345').kind).toBe('invalid');
  });

  it('rejects numbers not starting with 6–9', () => {
    expect(parseIdentifier('5876543210').kind).toBe('invalid');
  });

  it('rejects malformed emails', () => {
    expect(parseIdentifier('priya@').kind).toBe('invalid');
    expect(parseIdentifier('priya@@school.in').kind).toBe('invalid');
  });

  it('rejects empty input', () => {
    expect(parseIdentifier('   ')).toEqual({ kind: 'invalid', value: '' });
  });
});

describe('normalizeIndianMobile', () => {
  it('returns null for foreign numbers', () => {
    expect(normalizeIndianMobile('+1 415 555 0100')).toBeNull();
  });

  it('returns null for letters', () => {
    expect(normalizeIndianMobile('98765abcde')).toBeNull();
  });
});
