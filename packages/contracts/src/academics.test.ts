import { describe, expect, it } from 'vitest';

import {
  createSectionRequestSchema,
  SENIOR_CLASSES,
  STARTER_STREAMS,
  STARTER_SUBJECTS,
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
});
