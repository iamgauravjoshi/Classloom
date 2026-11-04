import { ApiError } from '@classloom/api-client';
import type { ProblemDetails } from '@classloom/contracts';
import { describe, expect, it } from 'vitest';

import messages from '../../../messages/en.json';
import {
  ACADEMICS_PROBLEM_TYPES,
  academicsErrorMessage,
  academicsProblemMessage,
  academicsProblemValues,
  formatList,
  IN_USE_KINDS,
} from './academics-errors';

const errorMessages = messages.academics.errors as Record<string, unknown>;

const problem = (type: string, status: number, extra: Partial<ProblemDetails> = {}) => ({
  type,
  title: 'x',
  status,
  ...extra,
});

describe('academicsProblemMessage', () => {
  it('maps every academics problem type, and the reused one, to its own en.json message', () => {
    expect([...ACADEMICS_PROBLEM_TYPES].sort()).toEqual(
      [
        'academic-year-locked',
        'academics-limit',
        'class-out-of-range',
        'classes-not-set',
        'in-use',
        'name-taken',
        'nothing-to-copy',
        'room-archived',
        'room-campus-mismatch',
        'sections-exist',
        'stream-archived',
        'stream-not-allowed',
        'stream-required',
        'subject-archived',
        'teacher-taken',
        'teacher-unavailable',
      ].sort(),
    );
    const keys = new Set<string>();
    for (const type of ACADEMICS_PROBLEM_TYPES) {
      const key = academicsProblemMessage(problem(type, 409));
      expect(key, type).not.toBe('generic');
      expect(errorMessages[key], `${type} -> ${key}`).toEqual(expect.any(String));
      keys.add(key);
    }
    expect(keys.size).toBe(ACADEMICS_PROBLEM_TYPES.length);
  });

  it('uses the counted, limited and named wording when the problem carries its extra', () => {
    const inUse = problem('in-use', 409, { counts: { sections: 2, classSubjects: 0 } });
    expect(academicsProblemMessage(inUse)).toBe('inUseBy');
    expect(academicsProblemValues(inUse)).toEqual({ counts: [['sections', 2]] });

    const limit = problem('academics-limit', 409, { limit: 20 });
    expect(academicsProblemMessage(limit)).toBe('academicsLimitOf');
    expect(academicsProblemValues(limit)).toEqual({ limit: 20 });

    const taken = problem('teacher-taken', 409, { sectionName: 'VI-A' });
    expect(academicsProblemMessage(taken)).toBe('teacherTakenBy');
    expect(academicsProblemValues(taken)).toEqual({ sectionName: 'VI-A' });

    for (const key of ['inUseBy', 'academicsLimitOf', 'teacherTakenBy']) {
      expect(errorMessages[key], key).toEqual(expect.any(String));
    }
  });

  it('has a phrase for every kind of use an in-use problem counts', () => {
    expect([...IN_USE_KINDS].sort()).toEqual(['classSubjects', 'sections']);
    const parts = errorMessages.inUseParts as Record<string, string>;
    for (const kind of IN_USE_KINDS) expect(parts[kind], kind).toEqual(expect.any(String));
  });

  it('ignores counts it has no words for, and zero counts', () => {
    const inUse = problem('in-use', 409, { counts: { sections: 0, other: 3 } });
    expect(academicsProblemMessage(inUse)).toBe('inUse');
  });

  it('matches a type that is a full address', () => {
    expect(
      academicsProblemMessage(problem('https://classloom.dev/problems/room-archived', 422)),
    ).toBe('roomArchived');
  });

  it('reads the status when the type names nothing', () => {
    expect(academicsProblemMessage(problem('permission-denied', 403))).toBe('permissionDenied');
    expect(academicsProblemMessage(problem('about:blank', 404))).toBe('notFound');
    expect(academicsProblemMessage(problem('about:blank', 429))).toBe('rateLimited');
    expect(academicsProblemMessage(problem('about:blank', 0))).toBe('network');
    for (const key of ['permissionDenied', 'notFound', 'rateLimited', 'network']) {
      expect(errorMessages[key], key).toEqual(expect.any(String));
    }
  });

  it('falls back to the generic message for an unknown type', () => {
    expect(academicsProblemMessage(problem('something-new', 409))).toBe('generic');
    expect(academicsProblemMessage(problem('about:blank', 500))).toBe('generic');
    expect(academicsProblemMessage(undefined)).toBe('generic');
    expect(errorMessages.generic).toEqual(expect.any(String));
  });
});

describe('academicsErrorMessage', () => {
  it('reads the problem of an ApiError', () => {
    const error = new ApiError(409, problem('name-taken', 409, { field: 'name' }));
    expect(academicsErrorMessage(error)).toBe('nameTaken');
  });

  it('is generic for anything else', () => {
    expect(academicsErrorMessage(new Error('x'))).toBe('generic');
    expect(academicsErrorMessage(undefined)).toBe('generic');
  });
});

describe('formatList', () => {
  it('joins in Indian English, with no comma before "and"', () => {
    expect(formatList(['Science', 'Commerce', 'Humanities'])).toBe(
      'Science, Commerce and Humanities',
    );
    expect(formatList(['2 sections', '1 class subject'])).toBe('2 sections and 1 class subject');
  });
});
