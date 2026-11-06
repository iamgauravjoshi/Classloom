import { ApiError } from '@classloom/api-client';

/** The school module's problem types (onboarding spec §11). */
export const SCHOOL_PROBLEM_TYPES = [
  'academic-year-overlap',
  'academic-year-planned-exists',
  'academic-terms-invalid',
  'academic-year-locked',
  'academic-year-label-taken',
  'campus-primary',
  'campus-last-active',
  'campus-name-taken',
  'campus-limit',
  'campus-inactive',
  'logo-invalid',
  'storage-unavailable',
  // The academics module's `in-use`: a planned year with sections cannot be deleted.
  'in-use',
] as const;
export type SchoolProblemType = (typeof SCHOOL_PROBLEM_TYPES)[number];

/** Why `logo-invalid` refused an upload. */
export const LOGO_REASONS = ['type', 'size', 'dimensions', 'decode'] as const;
export type LogoReason = (typeof LOGO_REASONS)[number];

/** Keys under `schoolSettings.errors` in `messages/en.json`. */
export type SchoolErrorKey =
  | 'academicYearOverlap'
  | 'academicYearPlannedExists'
  | 'academicTermsInvalid'
  | 'academicYearLocked'
  | 'academicYearLabelTaken'
  | 'academicYearHasSections'
  | 'campusPrimary'
  | 'campusLastActive'
  | 'campusNameTaken'
  | 'campusLimit'
  | 'campusInactive'
  | 'storageUnavailable'
  | 'logoInvalid'
  | 'logoType'
  | 'logoSize'
  | 'logoDimensions'
  | 'logoDecode'
  | 'permissionDenied'
  | 'rateLimited'
  | 'network'
  | 'generic';

const PROBLEM_KEYS: Record<Exclude<SchoolProblemType, 'logo-invalid'>, SchoolErrorKey> = {
  'academic-year-overlap': 'academicYearOverlap',
  'academic-year-planned-exists': 'academicYearPlannedExists',
  'academic-terms-invalid': 'academicTermsInvalid',
  'academic-year-locked': 'academicYearLocked',
  'academic-year-label-taken': 'academicYearLabelTaken',
  'in-use': 'academicYearHasSections',
  'campus-primary': 'campusPrimary',
  'campus-last-active': 'campusLastActive',
  'campus-name-taken': 'campusNameTaken',
  'campus-limit': 'campusLimit',
  'campus-inactive': 'campusInactive',
  'storage-unavailable': 'storageUnavailable',
};

const LOGO_KEYS: Record<LogoReason, SchoolErrorKey> = {
  type: 'logoType',
  size: 'logoSize',
  dimensions: 'logoDimensions',
  decode: 'logoDecode',
};

const isKnown = <T extends string>(values: readonly T[], value: string | undefined): value is T =>
  value !== undefined && (values as readonly string[]).includes(value);

/** The last segment of a problem type, so a bare name and a full address read the same. */
const typeName = (type: string) => type.slice(type.lastIndexOf('/') + 1);

/**
 * The `schoolSettings.errors` message for a school API refusal: its §11 type (and a logo's
 * `reason`), else its status (403, 429, a network failure), else the generic message.
 */
export function schoolProblemMessage(
  problem: { type: string; status: number; reason?: string } | undefined,
): SchoolErrorKey {
  if (!problem) return 'generic';
  const name = typeName(problem.type);
  if (name === 'logo-invalid') {
    return isKnown(LOGO_REASONS, problem.reason) ? LOGO_KEYS[problem.reason] : 'logoInvalid';
  }
  if (isKnown(SCHOOL_PROBLEM_TYPES, name)) return PROBLEM_KEYS[name as keyof typeof PROBLEM_KEYS];
  if (problem.status === 403) return 'permissionDenied';
  if (problem.status === 429) return 'rateLimited';
  if (problem.status === 0) return 'network';
  return 'generic';
}

/** `schoolProblemMessage` for whatever a mutation threw. */
export function schoolErrorMessage(error: unknown): SchoolErrorKey {
  return error instanceof ApiError ? schoolProblemMessage(error.problem) : 'generic';
}

/**
 * The values the message of `schoolErrorMessage(error)` needs: the sections a planned year still
 * has (`in-use` counts them), else none.
 */
export function schoolErrorValues(error: unknown): { count?: number } {
  if (schoolErrorMessage(error) !== 'academicYearHasSections') return {};
  return { count: (error as ApiError).problem.counts?.sections ?? 0 };
}

/** The fields a 400 names (`errors[].path`, first segment), once each. */
export function schoolFieldErrors(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.status !== 400) return [];
  return [...new Set((error.problem.errors ?? []).map((issue) => issue.path.split('.')[0] ?? ''))];
}

export const LOGO_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** The client's own check before an upload; the server still decides. */
export function checkLogoFile(file: { type: string; size: number }): 'type' | 'size' | null {
  if (!LOGO_TYPES.includes(file.type)) return 'type';
  if (file.size > MAX_LOGO_BYTES) return 'size';
  return null;
}
