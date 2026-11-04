import { describe, expect, it } from 'vitest';

import {
  classSubjectRowSchema,
  copySectionsRequestSchema,
  createSectionRequestSchema,
  SENIOR_CLASSES,
  STARTER_STREAMS,
  STARTER_SUBJECTS,
  starterSubjectsRequestSchema,
} from './academics';
import { BOARDS } from './tenancy';

describe('starter data', () => {
  it('has the three starter streams and senior classes', () => {
    expect(STARTER_STREAMS).toEqual(['Science', 'Commerce', 'Humanities']);
    expect(SENIOR_CLASSES).toEqual(['XI', 'XII']);
  });
  it.each(BOARDS)('%s list has unique names, valid types and codes', (board) => {
    const list = STARTER_SUBJECTS[board];
    expect(list.length).toBeGreaterThan(8);
    const names = list.map((s) => s.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const s of list) {
      expect(['SCHOLASTIC', 'CO_SCHOLASTIC']).toContain(s.type);
      if (s.code !== undefined) expect(s.code).toMatch(/^[A-Za-z0-9-]{1,10}$/);
    }
  });
  it('has the CBSE codes', () => {
    const l = STARTER_SUBJECTS.CBSE;
    expect(l).toContainEqual({
      name: 'English Language & Literature',
      code: '184',
      type: 'SCHOLASTIC',
    });
    expect(l).toContainEqual({ name: 'English Core', code: '301', type: 'SCHOLASTIC' });
    expect(l).toContainEqual({ name: 'Physics', code: '042', type: 'SCHOLASTIC' });
    expect(l).toContainEqual({ name: 'Mathematics (Standard)', code: '041', type: 'SCHOLASTIC' });
    expect(l).toContainEqual({ name: 'Mathematics', code: '041', type: 'SCHOLASTIC' });
    expect(l.filter((s) => s.type === 'CO_SCHOLASTIC').map((s) => s.name)).toEqual([
      'Art Education',
      'Health & Physical Education',
      'Work Education',
    ]);
  });
  it('gives other boards the primary and generic lists without codes', () => {
    const l = STARTER_SUBJECTS.ICSE;
    expect(l.map((s) => s.name)).toContain('Environmental Studies (EVS)');
    expect(l.map((s) => s.name)).toContain('History & Civics');
    expect(l.every((s) => s.code === undefined)).toBe(true);
  });
});

describe('createSectionRequestSchema', () => {
  const base = {
    academicYearId: '2b1e7c0a-5c64-4a8e-8f3d-7a6b9c0d1e22',
    campusId: '8d5f3c64-0f77-4d6e-9d0e-1f0c7a3f5a11',
    classLevel: 'V',
    name: ' A ',
    capacity: 40,
  };
  it('trims the name and accepts a null stream', () => {
    const r = createSectionRequestSchema.parse({ ...base, streamId: null });
    expect(r.name).toBe('A');
    expect(r.streamId).toBeNull();
  });
  it('rejects capacity 0 and 201', () => {
    expect(createSectionRequestSchema.safeParse({ ...base, capacity: 0 }).success).toBe(false);
    expect(createSectionRequestSchema.safeParse({ ...base, capacity: 201 }).success).toBe(false);
    expect(createSectionRequestSchema.safeParse({ ...base, capacity: 200 }).success).toBe(true);
  });
  it('requires the academic year', () => {
    const { academicYearId: _year, ...noYear } = base;
    expect(createSectionRequestSchema.safeParse(noYear).success).toBe(false);
  });
});

const U1 = '8d5f3c64-0f77-4d6e-9d0e-1f0c7a3f5a11';
const U2 = '2b1e7c0a-5c64-4a8e-8f3d-7a6b9c0d1e22';

describe('starterSubjectsRequestSchema', () => {
  it('parses items with name, optional code and type', () => {
    const r = starterSubjectsRequestSchema.parse({
      items: [
        { name: ' Physics ', code: '042', type: 'SCHOLASTIC' },
        { name: 'Art', type: 'CO_SCHOLASTIC' },
      ],
    });
    expect(r.items[0]).toEqual({ name: 'Physics', code: '042', type: 'SCHOLASTIC' });
    expect(r.items[1]!.code).toBeUndefined();
  });
  it('rejects bad input', () => {
    const bad = (items: unknown) => starterSubjectsRequestSchema.safeParse({ items }).success;
    expect(bad([])).toBe(false);
    expect(bad([{ name: 'A', type: 'SCHOLASTIC' }])).toBe(false);
    expect(bad([{ name: 'Physics', code: 'bad code!', type: 'SCHOLASTIC' }])).toBe(false);
    expect(bad([{ name: 'Physics', type: 'OTHER' }])).toBe(false);
    expect(starterSubjectsRequestSchema.safeParse({ names: ['Physics'] }).success).toBe(false);
  });
});

describe('copySectionsRequestSchema', () => {
  it('needs yearId and campusId uuids', () => {
    expect(copySectionsRequestSchema.safeParse({ yearId: U1, campusId: U2 }).success).toBe(true);
    expect(copySectionsRequestSchema.safeParse({ campusId: U2 }).success).toBe(false);
    expect(copySectionsRequestSchema.safeParse({ yearId: 'x', campusId: U2 }).success).toBe(false);
  });
});

describe('classSubjectRowSchema', () => {
  it('accepts a null or uuid stream and valid kinds', () => {
    expect(
      classSubjectRowSchema.safeParse({ subjectId: U1, streamId: null, kind: 'COMPULSORY' })
        .success,
    ).toBe(true);
    expect(
      classSubjectRowSchema.safeParse({ subjectId: U1, streamId: U2, kind: 'OPTIONAL' }).success,
    ).toBe(true);
  });
  it('rejects a missing stream, bad kind or non-uuid', () => {
    expect(classSubjectRowSchema.safeParse({ subjectId: U1, kind: 'COMPULSORY' }).success).toBe(
      false,
    );
    expect(
      classSubjectRowSchema.safeParse({ subjectId: U1, streamId: null, kind: 'X' }).success,
    ).toBe(false);
    expect(
      classSubjectRowSchema.safeParse({ subjectId: 'a', streamId: null, kind: 'OPTIONAL' }).success,
    ).toBe(false);
  });
});
