import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';

import type { ImageRejectionReason } from '../../core/files/image-intake';

/**
 * The problem types of the school module (onboarding spec section 11). Each exception carries its
 * `type`, a `title` and a `message` (rendered as `detail`) through `ProblemFilter`.
 */
export type SchoolProblemType =
  | 'academic-year-overlap'
  | 'academic-year-planned-exists'
  | 'academic-terms-invalid'
  | 'academic-year-locked'
  | 'academic-year-label-taken'
  | 'campus-primary'
  | 'campus-last-active'
  | 'campus-name-taken'
  | 'campus-limit'
  | 'campus-inactive'
  | 'logo-invalid'
  | 'storage-unavailable';

interface ProblemText {
  title: string;
  message: string;
}

const conflict = (type: SchoolProblemType, text: ProblemText) =>
  class extends ConflictException {
    constructor(errors?: { path: string; message: string }[]) {
      super({ type, ...text, ...(errors ? { errors } : {}) });
    }
  };

/* ---------------------------- Academic years ---------------------------- */

export class AcademicYearOverlapException extends conflict('academic-year-overlap', {
  title: 'These dates overlap another academic year.',
  message: 'Choose dates that do not overlap an existing year.',
}) {}

export class AcademicYearPlannedExistsException extends conflict('academic-year-planned-exists', {
  title: 'A planned year already exists.',
  message: 'Edit or delete the planned year before adding another.',
}) {}

export class AcademicYearLockedException extends conflict('academic-year-locked', {
  title: 'This academic year can no longer be changed.',
  message: 'Closed years cannot be edited, and only a planned year can be deleted.',
}) {}

export class AcademicYearLabelTakenException extends conflict('academic-year-label-taken', {
  title: 'This label is already used.',
  message: 'Give the year a label no other year uses.',
}) {}

/** 422: the terms do not tile the year, or there are not 2 or 3. `index` is the failing term. */
export class AcademicTermsInvalidException extends HttpException {
  constructor(index: number | null, message = 'The terms must cover the whole year, in order.') {
    super(
      {
        type: 'academic-terms-invalid' satisfies SchoolProblemType,
        title: 'The terms are not valid.',
        message,
        errors: [{ path: index === null ? 'terms' : `terms.${index}`, message }],
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/* ------------------------------- Campuses ------------------------------- */

export class CampusPrimaryException extends conflict('campus-primary', {
  title: 'The primary campus cannot be deactivated.',
  message: 'Make another campus primary first.',
}) {}

export class CampusLastActiveException extends conflict('campus-last-active', {
  title: 'The last active campus cannot be deactivated.',
  message: 'A school needs at least one active campus.',
}) {}

export class CampusNameTakenException extends conflict('campus-name-taken', {
  title: 'A campus with this name already exists.',
  message: 'Give the campus a name no other campus uses.',
}) {}

export class CampusLimitException extends conflict('campus-limit', {
  title: 'This school has the most campuses allowed.',
  message: 'A school can have up to 20 campuses, counting inactive ones.',
}) {}

export class CampusInactiveException extends conflict('campus-inactive', {
  title: 'An inactive campus cannot be made primary.',
  message: 'Reactivate the campus first.',
}) {}

/* ------------------------------ Logo, files ----------------------------- */

const LOGO_MESSAGES: Record<ImageRejectionReason, string> = {
  type: 'Upload a PNG, JPEG or WebP image.',
  size: 'The image must be 2 MB or smaller.',
  dimensions: 'The image must be between 64 pixels on each side and 25 megapixels.',
  decode: 'The image could not be read. Try another file.',
};

/** 422: the upload is not an acceptable logo; `reason` says why. */
export class LogoInvalidException extends HttpException {
  constructor(readonly reason: ImageRejectionReason) {
    super(
      {
        type: 'logo-invalid' satisfies SchoolProblemType,
        title: 'This logo cannot be used.',
        message: LOGO_MESSAGES[reason],
        reason,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 503: file storage could not be reached; nothing was written. */
export class StorageUnavailableException extends HttpException {
  constructor() {
    super(
      {
        type: 'storage-unavailable' satisfies SchoolProblemType,
        title: 'File storage is unavailable.',
        message: 'Try again in a few minutes.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
