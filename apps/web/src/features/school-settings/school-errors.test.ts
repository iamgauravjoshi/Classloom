import { ApiError } from '@classloom/api-client';
import type { ProblemDetails } from '@classloom/contracts';
import { describe, expect, it } from 'vitest';

import messages from '../../../messages/en.json';
import {
  checkLogoFile,
  LOGO_REASONS,
  SCHOOL_PROBLEM_TYPES,
  schoolErrorMessage,
  schoolProblemMessage,
} from './school-errors';

const errorMessages = messages.schoolSettings.errors as Record<string, string>;

const problem = (type: string, status: number, extra: Partial<ProblemDetails> = {}) => ({
  type,
  title: 'x',
  status,
  ...extra,
});

describe('schoolProblemMessage', () => {
  it('maps every spec §11 problem type to its own en.json message', () => {
    expect(SCHOOL_PROBLEM_TYPES).toHaveLength(12);
    const keys = new Set<string>();
    for (const type of SCHOOL_PROBLEM_TYPES) {
      if (type === 'logo-invalid') continue;
      const key = schoolProblemMessage(problem(type, 409));
      expect(key, type).not.toBe('generic');
      expect(errorMessages[key], `${type} -> ${key}`).toEqual(expect.any(String));
      keys.add(key);
    }
    expect(keys.size).toBe(SCHOOL_PROBLEM_TYPES.length - 1);
  });

  it('maps every logo-invalid reason to its own en.json message', () => {
    expect([...LOGO_REASONS].sort()).toEqual(['decode', 'dimensions', 'size', 'type']);
    const keys = new Set<string>();
    for (const reason of LOGO_REASONS) {
      const key = schoolProblemMessage(problem('logo-invalid', 422, { reason }));
      expect(errorMessages[key], `${reason} -> ${key}`).toEqual(expect.any(String));
      keys.add(key);
    }
    expect(keys.size).toBe(4);
  });

  it('gives a logo-invalid without a known reason the general logo message', () => {
    const key = schoolProblemMessage(problem('logo-invalid', 422, { reason: 'other' }));
    expect(key).toBe('logoInvalid');
    expect(errorMessages[key]).toEqual(expect.any(String));
  });

  it('matches a type that is a full address', () => {
    expect(schoolProblemMessage(problem('https://classloom.dev/problems/campus-limit', 409))).toBe(
      schoolProblemMessage(problem('campus-limit', 409)),
    );
  });

  it('reads the status when the type names nothing', () => {
    expect(schoolProblemMessage(problem('permission-denied', 403))).toBe('permissionDenied');
    expect(schoolProblemMessage(problem('about:blank', 429))).toBe('rateLimited');
    expect(schoolProblemMessage(problem('about:blank', 0))).toBe('network');
  });

  it('falls back to the generic message for an unknown type', () => {
    expect(schoolProblemMessage(problem('something-new', 409))).toBe('generic');
    expect(schoolProblemMessage(problem('about:blank', 500))).toBe('generic');
    expect(schoolProblemMessage(undefined)).toBe('generic');
    expect(errorMessages.generic).toEqual(expect.any(String));
  });

  it('has a message for every status fallback', () => {
    for (const key of ['permissionDenied', 'rateLimited', 'network', 'generic']) {
      expect(errorMessages[key], key).toEqual(expect.any(String));
    }
  });
});

describe('schoolErrorMessage', () => {
  it('reads the problem of an ApiError', () => {
    const error = new ApiError(422, problem('logo-invalid', 422, { reason: 'size' }));
    expect(schoolErrorMessage(error)).toBe(
      schoolProblemMessage(problem('logo-invalid', 422, { reason: 'size' })),
    );
  });

  it('is generic for anything else', () => {
    expect(schoolErrorMessage(new Error('x'))).toBe('generic');
    expect(schoolErrorMessage(undefined)).toBe('generic');
  });
});

describe('checkLogoFile', () => {
  const file = (type: string, size: number) => ({ type, size });

  it('accepts PNG, JPEG and WebP up to 2 MB', () => {
    expect(checkLogoFile(file('image/png', 1000))).toBeNull();
    expect(checkLogoFile(file('image/jpeg', 2 * 1024 * 1024))).toBeNull();
    expect(checkLogoFile(file('image/webp', 10))).toBeNull();
  });

  it('refuses another type, then a file over 2 MB', () => {
    expect(checkLogoFile(file('image/gif', 10))).toBe('type');
    expect(checkLogoFile(file('application/pdf', 10))).toBe('type');
    expect(checkLogoFile(file('image/png', 2 * 1024 * 1024 + 1))).toBe('size');
  });
});

describe('logo dimension copy', () => {
  it('names both limits, since a 25 MP+ image gets the same reason as a tiny one', () => {
    expect(errorMessages.logoDimensions).toBe(
      'The image must be between 64 pixels on each side and 25 megapixels.',
    );
  });
});
