import { describe, expect, it } from 'vitest';

import { isValidAffiliationNumber, isValidUdise, normalizeIndianPhone } from './school-ids';

describe('isValidUdise', () => {
  it('accepts 11 digits with a valid state code', () => {
    expect(isValidUdise('09050100101')).toBe(true);
  });
  it.each(['39050100101', '00050100101', '0905010010', '0905010010a', '090501001011', ''])(
    'rejects %s',
    (s) => expect(isValidUdise(s)).toBe(false),
  );
});

describe('isValidAffiliationNumber', () => {
  it('accepts digits and slash-separated codes', () => {
    expect(isValidAffiliationNumber('2130176')).toBe(true);
    expect(isValidAffiliationNumber('KA/EDN/2011/1187')).toBe(true);
  });
  it('rejects empty, too long and odd characters', () => {
    expect(isValidAffiliationNumber('')).toBe(false);
    expect(isValidAffiliationNumber('A'.repeat(31))).toBe(false);
    expect(isValidAffiliationNumber('A'.repeat(30))).toBe(true);
    expect(isValidAffiliationNumber('12 34')).toBe(false);
  });
});

describe('normalizeIndianPhone', () => {
  it('normalises mobiles', () => {
    expect(normalizeIndianPhone('098450 11223')).toBe('+919845011223');
    expect(normalizeIndianPhone('+91 98450 11223')).toBe('+919845011223');
  });
  it('accepts landlines with the STD code', () => {
    expect(normalizeIndianPhone('080-41238800')).toBe('+918041238800');
  });
  it('rejects bad numbers', () => {
    expect(normalizeIndianPhone('12345')).toBeNull();
    expect(normalizeIndianPhone('0000000000')).toBeNull();
    expect(normalizeIndianPhone('98450abc23')).toBeNull();
  });
});
