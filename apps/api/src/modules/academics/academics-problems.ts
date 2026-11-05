import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';

export { AcademicYearLockedException } from '../school/school-problems';

/**
 * The problem types of the academics module (academics spec section 7). Each exception carries
 * its `type`, a `title` and a `message` (rendered as `detail`) through `ProblemFilter`, plus the
 * extra field the client acts on (`field`, `limit`, `counts`, `sectionName`) where there is one.
 * `academic-year-locked` is Part 4's, re-exported above.
 */
export type AcademicsProblemType =
  | 'classes-not-set'
  | 'class-out-of-range'
  | 'name-taken'
  | 'in-use'
  | 'academics-limit'
  | 'room-campus-mismatch'
  | 'room-archived'
  | 'teacher-unavailable'
  | 'teacher-taken'
  | 'stream-required'
  | 'stream-not-allowed'
  | 'stream-archived'
  | 'sections-exist'
  | 'nothing-to-copy'
  | 'subject-archived';

interface ProblemText {
  title: string;
  message: string;
}

type FieldErrors = { path: string; message: string }[];

const body = (type: AcademicsProblemType, text: ProblemText, errors?: FieldErrors) => ({
  type,
  ...text,
  ...(errors ? { errors } : {}),
});

const conflict = (type: AcademicsProblemType, text: ProblemText) =>
  class extends ConflictException {
    constructor(errors?: FieldErrors) {
      super(body(type, text, errors));
    }
  };

const unprocessable = (type: AcademicsProblemType, text: ProblemText) =>
  class extends HttpException {
    constructor(errors?: FieldErrors) {
      super(body(type, text, errors), HttpStatus.UNPROCESSABLE_ENTITY);
    }
  };

/* ------------------------------ Class range ----------------------------- */

export class ClassesNotSetException extends conflict('classes-not-set', {
  title: "The school's classes are not set.",
  message: 'Set the lowest and highest class in the school profile first.',
}) {}

export class ClassOutOfRangeException extends unprocessable('class-out-of-range', {
  title: "This class is outside the school's classes.",
  message: 'Choose a class inside the range set in the school profile.',
}) {}

/* ------------------------- Names, use and limits ------------------------ */

/** 409: the value of `field` (e.g. `name`) is already used. */
export class NameTakenException extends ConflictException {
  constructor(readonly field: string) {
    super({
      type: 'name-taken' satisfies AcademicsProblemType,
      title: 'This name is already used.',
      message: 'Choose a name nothing else uses.',
      field,
    });
  }
}

/** 409: the item is still used; `counts` says by how many rows of each kind. */
export class InUseException extends ConflictException {
  constructor(readonly counts: Record<string, number>) {
    super({
      type: 'in-use' satisfies AcademicsProblemType,
      title: 'This is still in use.',
      message: 'Remove it from everything that uses it first, or archive it instead.',
      counts,
    });
  }
}

/** 409: the school already has the most of this kind allowed. */
export class AcademicsLimitException extends ConflictException {
  constructor(readonly limit: number) {
    super({
      type: 'academics-limit' satisfies AcademicsProblemType,
      title: 'This school has the most allowed.',
      message: `A school can have up to ${limit}, counting archived ones.`,
      limit,
    });
  }
}

/* --------------------------------- Rooms -------------------------------- */

export class RoomCampusMismatchException extends unprocessable('room-campus-mismatch', {
  title: 'This room is on another campus.',
  message: "Choose a room on the section's campus.",
}) {}

export class RoomArchivedException extends unprocessable('room-archived', {
  title: 'This room is archived.',
  message: 'Restore the room or choose another.',
}) {}

/* ------------------------------- Teachers ------------------------------- */

export class TeacherUnavailableException extends unprocessable('teacher-unavailable', {
  title: 'This person cannot be class teacher.',
  message: 'Choose an active member of this school.',
}) {}

/**
 * 409: the teacher already leads `sectionName` this academic year. Without a name (the database's
 * unique index caught a race the API's check missed) the problem carries no `sectionName`.
 */
export class TeacherTakenException extends ConflictException {
  constructor(readonly sectionName?: string) {
    super({
      type: 'teacher-taken' satisfies AcademicsProblemType,
      title: 'This teacher already leads a section this year.',
      message: sectionName
        ? `They are class teacher of ${sectionName}.`
        : 'They are class teacher of another section.',
      ...(sectionName ? { sectionName } : {}),
    });
  }
}

/* -------------------------------- Streams ------------------------------- */

export class StreamRequiredException extends unprocessable('stream-required', {
  title: 'Choose a stream.',
  message: 'Classes XI and XII need a stream while the school has active streams.',
}) {}

export class StreamNotAllowedException extends unprocessable('stream-not-allowed', {
  title: 'This stream cannot be used here.',
  message: 'Only classes XI and XII have streams.',
}) {}

export class StreamArchivedException extends unprocessable('stream-archived', {
  title: 'This stream is archived.',
  message: 'Restore the stream or choose another.',
}) {}

/* ------------------------------- Sections ------------------------------- */

export class SectionsExistException extends conflict('sections-exist', {
  title: 'This year already has sections.',
  message: 'Sections are copied only into a year and campus with none.',
}) {}

export class NothingToCopyException extends conflict('nothing-to-copy', {
  title: 'There are no sections to copy.',
  message: 'The previous year has no sections on this campus.',
}) {}

/* ------------------------------- Subjects ------------------------------- */

export class SubjectArchivedException extends unprocessable('subject-archived', {
  title: 'This subject is archived.',
  message: 'Restore the subject before adding it to a class.',
}) {}
