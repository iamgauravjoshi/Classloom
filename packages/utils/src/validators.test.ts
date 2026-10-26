import { describe, expect, it } from 'vitest';

import { isValidAadhaar, isValidIFSC, isValidPincode, maskAadhaar } from './validators';

describe('isValidPincode', () => {
  it('accepts six digits not starting with 0', () => {
    expect(isValidPincode('248001')).toBe(true);
  });

  it('rejects a leading zero', () => {
    expect(isValidPincode('048001')).toBe(false);
  });

  it('rejects wrong lengths', () => {
    expect(isValidPincode('24800')).toBe(false);
  });
});

describe('isValidAadhaar', () => {
  it('accepts a number with a valid Verhoeff checksum', () => {
    expect(isValidAadhaar('234123412346')).toBe(true);
  });

  it('accepts spaces between groups', () => {
    expect(isValidAadhaar('2341 2341 2346')).toBe(true);
  });

  it('rejects a bad checksum', () => {
    expect(isValidAadhaar('234123412341')).toBe(false);
  });

  it('rejects numbers starting with 0 or 1', () => {
    expect(isValidAadhaar('123412341234')).toBe(false);
  });
});

describe('maskAadhaar', () => {
  it('shows only the last four digits', () => {
    expect(maskAadhaar('234123412346')).toBe('XXXX-XXXX-2346');
  });
});

describe('isValidIFSC', () => {
  it('accepts 4 letters, 0, then 6 alphanumerics', () => {
    expect(isValidIFSC('SBIN0001234')).toBe(true);
  });

  it('requires the fifth character to be 0', () => {
    expect(isValidIFSC('SBIN1001234')).toBe(false);
  });
});
