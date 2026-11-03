export const ONBOARDING_ITEMS = ['profile', 'logo', 'academicYear', 'campuses'] as const;
export type OnboardingItemKey = (typeof ONBOARDING_ITEMS)[number];

const filled = (v: string | null | undefined) => v != null && v.trim() !== '';

/** Which onboarding items are done (spec §9). */
export function checklistOf(input: {
  profile: {
    udiseCode: string | null;
    addressLine1: string | null;
    pinCode: string | null;
    phone: string | null;
    logoFileId: string | null;
  };
  hasCurrentYear: boolean;
  primaryCampus: { addressLine1: string | null; pinCode: string | null };
}): { key: OnboardingItemKey; done: boolean }[] {
  const { profile, hasCurrentYear, primaryCampus } = input;
  return [
    {
      key: 'profile',
      done:
        filled(profile.udiseCode) &&
        filled(profile.addressLine1) &&
        filled(profile.pinCode) &&
        filled(profile.phone),
    },
    { key: 'logo', done: filled(profile.logoFileId) },
    { key: 'academicYear', done: hasCurrentYear },
    { key: 'campuses', done: filled(primaryCampus.addressLine1) && filled(primaryCampus.pinCode) },
  ];
}
