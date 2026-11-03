import { describe, expect, it } from 'vitest';

import {
  CLASS_LEVELS,
  createAcademicYearRequestSchema,
  createCampusRequestSchema,
  updateSchoolProfileRequestSchema,
} from './school';

describe('CLASS_LEVELS', () => {
  it('runs from NURSERY to XII', () => {
    expect(CLASS_LEVELS[0]).toBe('NURSERY');
    expect(CLASS_LEVELS[3]).toBe('I');
    expect(CLASS_LEVELS.at(-1)).toBe('XII');
    expect(CLASS_LEVELS).toHaveLength(15);
  });
});

describe('updateSchoolProfileRequestSchema', () => {
  it('turns empty strings into null', () => {
    const r = updateSchoolProfileRequestSchema.parse({
      name: 'Green Valley',
      board: 'CBSE',
      legalName: '',
      udiseCode: '',
      phone: '',
      website: '',
      state: 'UK',
    });
    expect(r.legalName).toBeNull();
    expect(r.udiseCode).toBeNull();
    expect(r.phone).toBeNull();
    expect(r.website).toBeNull();
  });
  it('normalises the phone', () => {
    const r = updateSchoolProfileRequestSchema.parse({
      name: 'Green Valley',
      board: 'CBSE',
      state: 'UK',
      phone: '098450 11223',
    });
    expect(r.phone).toBe('+919845011223');
  });
  it('rejects lowestClass above highestClass', () => {
    const r = updateSchoolProfileRequestSchema.safeParse({
      name: 'Green Valley',
      board: 'CBSE',
      state: 'UK',
      lowestClass: 'XII',
      highestClass: 'I',
    });
    expect(r.success).toBe(false);
  });
  it('rejects a bad UDISE code with a field error', () => {
    const r = updateSchoolProfileRequestSchema.safeParse({
      name: 'Green Valley',
      board: 'CBSE',
      state: 'UK',
      udiseCode: '39050100101',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['udiseCode']);
  });
});

describe('createAcademicYearRequestSchema', () => {
  it('accepts termCount or terms', () => {
    expect(
      createAcademicYearRequestSchema.safeParse({
        startsOn: '2026-04-01',
        endsOn: '2027-03-31',
        termCount: 2,
      }).success,
    ).toBe(true);
    expect(
      createAcademicYearRequestSchema.safeParse({
        startsOn: '2026-04-01',
        endsOn: '2027-03-31',
        terms: [
          { name: 'Term 1', startsOn: '2026-04-01', endsOn: '2026-09-30' },
          { name: 'Term 2', startsOn: '2026-10-01', endsOn: '2027-03-31' },
        ],
      }).success,
    ).toBe(true);
  });
  it('rejects neither, termCount 4 and bad dates', () => {
    const base = { startsOn: '2026-04-01', endsOn: '2027-03-31' };
    expect(createAcademicYearRequestSchema.safeParse(base).success).toBe(false);
    expect(createAcademicYearRequestSchema.safeParse({ ...base, termCount: 4 }).success).toBe(
      false,
    );
    expect(
      createAcademicYearRequestSchema.safeParse({ ...base, startsOn: '2026-02-30', termCount: 2 })
        .success,
    ).toBe(false);
  });
});

describe('createCampusRequestSchema', () => {
  it('requires a name and nulls empty optional fields', () => {
    const r = createCampusRequestSchema.parse({ name: ' North ', addressLine1: '', pinCode: '' });
    expect(r.name).toBe('North');
    expect(r.addressLine1).toBeNull();
    expect(r.pinCode).toBeNull();
    expect(createCampusRequestSchema.safeParse({ name: 'x', pinCode: '012345' }).success).toBe(
      false,
    );
  });
});
