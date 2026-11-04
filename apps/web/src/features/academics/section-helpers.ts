import { ApiError } from '@classloom/api-client';
import { CLASS_LEVELS, classesInRange, type ClassLevel } from '@classloom/contracts';

/** The school profile's class range; both ends null while it isn't set. */
export interface ClassRange {
  lowest: ClassLevel | null;
  highest: ClassLevel | null;
}

/** One class on the Sections tab, with its sections by name. */
export interface ClassGroup<
  T extends { classLevel: ClassLevel; name: string } = {
    classLevel: ClassLevel;
    name: string;
  },
> {
  classLevel: ClassLevel;
  sections: T[];
  /** Outside the profile range: listed last, readable and deletable but not editable. */
  outsideRange: boolean;
}

const byName = new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' });

/**
 * The sections of a year and campus by class: every class in the profile range in `CLASS_LEVELS`
 * order (an empty one too, so a section can be added to it), then any class outside the range that
 * still has sections, flagged.
 */
export function groupByClass<T extends { classLevel: ClassLevel; name: string }>(
  sections: readonly T[],
  range: ClassRange,
): ClassGroup<T>[] {
  const inRange = new Set(classesInRange(range.lowest, range.highest));
  const groups = (outside: boolean) =>
    CLASS_LEVELS.filter((level) => inRange.has(level) !== outside).flatMap((classLevel) => {
      const own = sections
        .filter((s) => s.classLevel === classLevel)
        .sort((a, b) => byName.compare(a.name, b.name));
      return outside && own.length === 0
        ? []
        : [{ classLevel, sections: own, outsideRange: outside }];
    });
  return [...groups(false), ...groups(true)];
}

/** The year copy-forward copies from: the latest one that ends before `year` starts. */
export function previousYearOf<T extends { id: string; startsOn: string; endsOn: string }>(
  years: readonly T[],
  year: { startsOn: string },
): T | null {
  // ISO dates compare as strings.
  return (
    years
      .filter((y) => y.endsOn < year.startsOn)
      .sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0] ?? null
  );
}

/** Whether a room seats fewer than the section holds: a warning, never a refusal. */
export function roomTooSmall(roomCapacity: number | undefined, sectionCapacity: number): boolean {
  return (
    roomCapacity !== undefined && Number.isFinite(sectionCapacity) && roomCapacity < sectionCapacity
  );
}

export const DROPPED_FIELDS = ['class', 'room', 'teacher', 'stream'] as const;
export type DroppedField = (typeof DROPPED_FIELDS)[number];

/** Copy-forward's dropped items by field (`class` first: those sections weren't copied at all). */
export function groupDropped(
  dropped: readonly { section: string; field: DroppedField }[],
): { field: DroppedField; sections: string[] }[] {
  return DROPPED_FIELDS.flatMap((field) => {
    const sections = dropped.filter((d) => d.field === field).map((d) => d.section);
    return sections.length > 0 ? [{ field, sections }] : [];
  });
}

/** The section form's fields a refusal can point at. */
export const SECTION_FIELDS = [
  'name',
  'capacity',
  'streamId',
  'roomId',
  'classTeacherMembershipId',
] as const;
export type SectionField = (typeof SECTION_FIELDS)[number];

/** The field each field-specific problem type is about. */
const PROBLEM_FIELDS: Record<string, SectionField> = {
  'name-taken': 'name',
  'room-campus-mismatch': 'roomId',
  'room-archived': 'roomId',
  'teacher-unavailable': 'classTeacherMembershipId',
  'teacher-taken': 'classTeacherMembershipId',
  'stream-required': 'streamId',
  'stream-not-allowed': 'streamId',
  'stream-archived': 'streamId',
};

const isSectionField = (value: string | undefined): value is SectionField =>
  (SECTION_FIELDS as readonly (string | undefined)[]).includes(value);

/**
 * The form field a refusal belongs on: the problem's `field`, else its first error's path, else
 * the field its type is about. Null when it is about the whole section (or the field is unknown).
 */
export function sectionErrorField(error: unknown): SectionField | null {
  if (!(error instanceof ApiError)) return null;
  const { problem } = error;
  if (problem.field !== undefined) return isSectionField(problem.field) ? problem.field : null;
  const path = problem.errors?.[0]?.path.split('.').pop();
  if (isSectionField(path)) return path;
  return PROBLEM_FIELDS[problem.type.slice(problem.type.lastIndexOf('/') + 1)] ?? null;
}

/**
 * Whether a class-teacher option already leads a section other than the one being edited (whose
 * teacher is `currentTeacherId`). Compared by membership: labels such as VI-A repeat across
 * campuses, and a teacher leads at most one section a year.
 */
export function leadsAnotherSection(
  option: { membershipId: string; sectionName: string | null },
  currentTeacherId: string | null | undefined,
): boolean {
  return option.sectionName !== null && option.membershipId !== currentTeacherId;
}

/** How many of the previous year's sections copy-forward would copy: those in the range. */
export function copyableCount(
  sections: readonly { classLevel: ClassLevel }[],
  range: ClassRange,
): number {
  const inRange = new Set(classesInRange(range.lowest, range.highest));
  return sections.filter((s) => inRange.has(s.classLevel)).length;
}
