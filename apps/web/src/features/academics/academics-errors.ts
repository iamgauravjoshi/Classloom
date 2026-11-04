import { ApiError } from '@classloom/api-client';
import type { ProblemDetails } from '@classloom/contracts';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

/** The academics problem types (academics spec section 7), with Part 4's `academic-year-locked`. */
export const ACADEMICS_PROBLEM_TYPES = [
  'classes-not-set',
  'class-out-of-range',
  'name-taken',
  'in-use',
  'academics-limit',
  'academic-year-locked',
  'room-campus-mismatch',
  'room-archived',
  'teacher-unavailable',
  'teacher-taken',
  'stream-required',
  'stream-not-allowed',
  'stream-archived',
  'sections-exist',
  'nothing-to-copy',
  'subject-archived',
] as const;
export type AcademicsProblemType = (typeof ACADEMICS_PROBLEM_TYPES)[number];

/** What an `in-use` problem counts, each with a phrase under `academics.errors.inUseParts`. */
export const IN_USE_KINDS = ['sections', 'classSubjects'] as const;
export type InUseKind = (typeof IN_USE_KINDS)[number];

/** Keys under `academics.errors` in `messages/en.json`. */
export type AcademicsErrorKey =
  | 'classesNotSet'
  | 'classOutOfRange'
  | 'nameTaken'
  | 'inUse'
  | 'inUseBy'
  | 'academicsLimit'
  | 'academicsLimitOf'
  | 'academicYearLocked'
  | 'roomCampusMismatch'
  | 'roomArchived'
  | 'teacherUnavailable'
  | 'teacherTaken'
  | 'teacherTakenBy'
  | 'streamRequired'
  | 'streamNotAllowed'
  | 'streamArchived'
  | 'sectionsExist'
  | 'nothingToCopy'
  | 'subjectArchived'
  | 'permissionDenied'
  | 'notFound'
  | 'rateLimited'
  | 'network'
  | 'generic';

const PROBLEM_KEYS: Record<AcademicsProblemType, AcademicsErrorKey> = {
  'classes-not-set': 'classesNotSet',
  'class-out-of-range': 'classOutOfRange',
  'name-taken': 'nameTaken',
  'in-use': 'inUse',
  'academics-limit': 'academicsLimit',
  'academic-year-locked': 'academicYearLocked',
  'room-campus-mismatch': 'roomCampusMismatch',
  'room-archived': 'roomArchived',
  'teacher-unavailable': 'teacherUnavailable',
  'teacher-taken': 'teacherTaken',
  'stream-required': 'streamRequired',
  'stream-not-allowed': 'streamNotAllowed',
  'stream-archived': 'streamArchived',
  'sections-exist': 'sectionsExist',
  'nothing-to-copy': 'nothingToCopy',
  'subject-archived': 'subjectArchived',
};

type Problem = Pick<ProblemDetails, 'type' | 'status'> &
  Partial<Pick<ProblemDetails, 'counts' | 'limit' | 'sectionName' | 'field'>>;

const isKnown = <T extends string>(values: readonly T[], value: string): value is T =>
  (values as readonly string[]).includes(value);

/** The last segment of a problem type, so a bare name and a full address read the same. */
const typeName = (type: string) => type.slice(type.lastIndexOf('/') + 1);

/** The kinds of use an `in-use` problem counts above zero, in a fixed order. */
const inUseCounts = (problem: Problem): [InUseKind, number][] =>
  IN_USE_KINDS.flatMap((kind) => {
    const count = problem.counts?.[kind] ?? 0;
    return count > 0 ? [[kind, count] as [InUseKind, number]] : [];
  });

/**
 * The `academics.errors` message for an academics API refusal: its section 7 type (with the
 * counted, limited or named wording when the problem carries `counts`, `limit` or `sectionName`),
 * else its status (403, 404, 429, a network failure), else the generic message.
 */
export function academicsProblemMessage(problem: Problem | undefined): AcademicsErrorKey {
  if (!problem) return 'generic';
  const name = typeName(problem.type);
  if (isKnown(ACADEMICS_PROBLEM_TYPES, name)) {
    if (name === 'in-use' && inUseCounts(problem).length > 0) return 'inUseBy';
    if (name === 'academics-limit' && typeof problem.limit === 'number') return 'academicsLimitOf';
    if (name === 'teacher-taken' && problem.sectionName) return 'teacherTakenBy';
    return PROBLEM_KEYS[name];
  }
  if (problem.status === 403) return 'permissionDenied';
  if (problem.status === 404) return 'notFound';
  if (problem.status === 429) return 'rateLimited';
  if (problem.status === 0) return 'network';
  return 'generic';
}

/** The values the message of `academicsProblemMessage(problem)` needs, if any. */
export function academicsProblemValues(problem: Problem | undefined): {
  counts?: [InUseKind, number][];
  limit?: number;
  sectionName?: string;
} {
  switch (academicsProblemMessage(problem)) {
    case 'inUseBy':
      return { counts: inUseCounts(problem!) };
    case 'academicsLimitOf':
      return { limit: problem!.limit! };
    case 'teacherTakenBy':
      return { sectionName: problem!.sectionName! };
    default:
      return {};
  }
}

/** `academicsProblemMessage` for whatever a mutation threw. */
export function academicsErrorMessage(error: unknown): AcademicsErrorKey {
  return error instanceof ApiError ? academicsProblemMessage(error.problem) : 'generic';
}

/** Whether a mutation was refused because the name is taken (shown on the name field). */
export function isNameTaken(error: unknown): boolean {
  return error instanceof ApiError && typeName(error.problem.type) === 'name-taken';
}

/**
 * "Science, Commerce and Humanities": a list in Indian English, which has no comma before "and".
 * The app's one locale is `en`, whose Intl default (US) would add one.
 */
export function formatList(items: readonly string[]): string {
  return new Intl.ListFormat('en-IN', { type: 'conjunction' }).format(items);
}

/** The sentence for an academics refusal, with its counts, limit or section filled in. */
export function useAcademicsErrorText(): (error: unknown) => string {
  const t = useTranslations('academics.errors');
  return useCallback(
    (error: unknown) => {
      const problem = error instanceof ApiError ? error.problem : undefined;
      const key = academicsProblemMessage(problem);
      const values = academicsProblemValues(problem);
      if (key === 'inUseBy') {
        const parts = (values.counts ?? []).map(([kind, count]) =>
          t(`inUseParts.${kind}`, { count }),
        );
        return t(key, { uses: formatList(parts) });
      }
      if (key === 'academicsLimitOf') return t(key, { limit: values.limit ?? 0 });
      if (key === 'teacherTakenBy') return t(key, { sectionName: values.sectionName ?? '' });
      return t(key);
    },
    [t],
  );
}
