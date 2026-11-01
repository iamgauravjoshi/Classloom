import { BadRequestException } from '@nestjs/common';

import type { PasswordIssue } from './password-policy';

const MESSAGES: Record<PasswordIssue, string> = {
  too_short: 'Use at least 10 characters.',
  too_long: 'Use at most 128 characters.',
  common: 'This password is too common. Choose something harder to guess.',
  contains_email: 'Leave your email address out of the password.',
  contains_school_code: 'Leave your school code out of the password.',
};

/**
 * The 400 for a password the policy refuses, in the shape `ProblemFilter` renders for Zod
 * validation (`errors[]` with a `path`), plus the rule that failed as `code`. Shared by password
 * reset and `PUT /me/password`.
 */
export function policyErrors(issues: PasswordIssue[], path = 'newPassword'): BadRequestException {
  return new BadRequestException({
    title: 'Bad Request',
    message: 'Validation failed',
    errors: issues.map((code) => ({ path, code, message: MESSAGES[code] })),
  });
}
