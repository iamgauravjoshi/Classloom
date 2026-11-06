import { describe, expect, it } from 'vitest';

import { checklistOf, ONBOARDING_ITEMS } from './onboarding';

type Profile = {
  udiseCode: string | null;
  addressLine1: string | null;
  pinCode: string | null;
  phone: string | null;
  logoFileId: string | null;
};

const empty = {
  profile: { udiseCode: null, addressLine1: null, pinCode: null, phone: null, logoFileId: null },
  hasCurrentYear: false,
  hasCurrentYearSection: false,
  hasClassSubject: false,
  primaryCampus: { addressLine1: null, pinCode: null },
};

describe('checklistOf', () => {
  it('is all false for an empty profile, in item order', () => {
    const items = checklistOf(empty);
    expect(items.map((i) => i.key)).toEqual([...ONBOARDING_ITEMS]);
    expect(items.every((i) => !i.done)).toBe(true);
  });
  it('marks profile done only when all four fields are present', () => {
    const full: Profile = {
      ...empty.profile,
      udiseCode: '09050100101',
      addressLine1: 'x',
      pinCode: '248001',
      phone: '+919845011223',
    };
    const done = (p: Profile) =>
      checklistOf({ ...empty, profile: p }).find((i) => i.key === 'profile')!.done;
    expect(done(full)).toBe(true);
    expect(done({ ...full, phone: null })).toBe(false);
    expect(done({ ...full, pinCode: null })).toBe(false);
    expect(done({ ...full, addressLine1: null })).toBe(false);
    expect(done({ ...full, udiseCode: null })).toBe(false);
  });
  it('tracks logo and academic year', () => {
    const items = checklistOf({
      ...empty,
      profile: { ...empty.profile, logoFileId: 'f1' },
      hasCurrentYear: true,
    });
    expect(items.find((i) => i.key === 'logo')!.done).toBe(true);
    expect(items.find((i) => i.key === 'academicYear')!.done).toBe(true);
  });
  it('follows the primary campus address and PIN', () => {
    const c = (primaryCampus: { addressLine1: string | null; pinCode: string | null }) =>
      checklistOf({ ...empty, primaryCampus }).find((i) => i.key === 'campuses')!.done;
    expect(c({ addressLine1: 'x', pinCode: '248001' })).toBe(true);
    expect(c({ addressLine1: 'x', pinCode: null })).toBe(false);
    expect(c({ addressLine1: null, pinCode: '248001' })).toBe(false);
  });
  it('marks academics done only when a section and a class subject exist', () => {
    const a = (hasCurrentYearSection: boolean, hasClassSubject: boolean) =>
      checklistOf({ ...empty, hasCurrentYearSection, hasClassSubject }).find(
        (i) => i.key === 'academics',
      )!.done;
    expect(a(true, true)).toBe(true);
    expect(a(true, false)).toBe(false);
    expect(a(false, true)).toBe(false);
  });
});
