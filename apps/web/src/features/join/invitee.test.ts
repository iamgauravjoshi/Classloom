import { describe, expect, it } from 'vitest';

import { isOtherAccount, maskEmail } from './invitee';

describe('maskEmail', () => {
  it('keeps the first letter and the domain, as the API does', () => {
    expect(maskEmail('asha@school.in')).toBe('a***@school.in');
    expect(maskEmail('a@school.in')).toBe('*@school.in');
  });
});

describe('isOtherAccount', () => {
  it('is false when nobody is signed in', () => {
    expect(isOtherAccount('a***@school.in', null)).toBe(false);
  });

  it('is false for the invited address, whatever its case', () => {
    expect(isOtherAccount('a***@school.in', 'asha@school.in')).toBe(false);
    expect(isOtherAccount('a***@school.in', 'Asha@School.in')).toBe(false);
  });

  it('is true for a different address', () => {
    expect(isOtherAccount('a***@school.in', 'ravi@school.in')).toBe(true);
    expect(isOtherAccount('a***@school.in', 'asha@other.in')).toBe(true);
  });
});
