import { ApiError } from '@classloom/api-client';
import { describe, expect, it } from 'vitest';

import {
  type ClassGroup,
  copyableCount,
  groupByClass,
  groupDropped,
  leadsAnotherSection,
  previousYearOf,
  roomTooSmall,
  sectionErrorField,
} from './section-helpers';

const section = (classLevel: ClassGroup['classLevel'], name: string) => ({ classLevel, name });

describe('groupByClass', () => {
  it('orders the classes Nursery to XII and keeps empty in-range classes', () => {
    const groups = groupByClass(
      [section('II', 'A'), section('NURSERY', 'Rose'), section('I', 'B'), section('I', 'A')],
      { lowest: 'NURSERY', highest: 'III' },
    );
    expect(groups.map((g) => g.classLevel)).toEqual(['NURSERY', 'LKG', 'UKG', 'I', 'II', 'III']);
    expect(groups.find((g) => g.classLevel === 'LKG')).toEqual({
      classLevel: 'LKG',
      sections: [],
      outsideRange: false,
    });
    // Within a class, by name.
    expect(groups.find((g) => g.classLevel === 'I')!.sections.map((s) => s.name)).toEqual([
      'A',
      'B',
    ]);
  });

  it('puts classes outside the range last, flagged, and only when they have sections', () => {
    const groups = groupByClass(
      [section('XII', 'Sci'), section('NURSERY', 'A'), section('VII', 'A'), section('XI', 'B')],
      { lowest: 'VI', highest: 'X' },
    );
    expect(groups.map((g) => [g.classLevel, g.outsideRange])).toEqual([
      ['VI', false],
      ['VII', false],
      ['VIII', false],
      ['IX', false],
      ['X', false],
      ['NURSERY', true],
      ['XI', true],
      ['XII', true],
    ]);
  });

  it('flags every class with sections as outside when no range is set', () => {
    const groups = groupByClass([section('V', 'A'), section('I', 'A')], {
      lowest: null,
      highest: null,
    });
    expect(groups.map((g) => [g.classLevel, g.outsideRange])).toEqual([
      ['I', true],
      ['V', true],
    ]);
  });

  it('orders section names naturally', () => {
    const [group] = groupByClass([section('I', '10'), section('I', '2'), section('I', 'a')], {
      lowest: 'I',
      highest: 'I',
    });
    expect(group!.sections.map((s) => s.name)).toEqual(['2', '10', 'a']);
  });
});

describe('previousYearOf', () => {
  const years = [
    { id: 'y27', startsOn: '2027-04-01', endsOn: '2028-03-31' },
    { id: 'y26', startsOn: '2026-04-01', endsOn: '2027-03-31' },
    { id: 'y24', startsOn: '2024-04-01', endsOn: '2025-03-31' },
    { id: 'y25', startsOn: '2025-04-01', endsOn: '2026-03-31' },
  ];

  it('is the latest year that ends before the year starts', () => {
    expect(previousYearOf(years, years[1]!)?.id).toBe('y25');
    expect(previousYearOf(years, years[0]!)?.id).toBe('y26');
  });

  it('is null for the earliest year', () => {
    expect(previousYearOf(years, years[2]!)).toBeNull();
  });
});

describe('roomTooSmall', () => {
  it('is true only when the room seats fewer than the section holds', () => {
    expect(roomTooSmall(30, 40)).toBe(true);
    expect(roomTooSmall(40, 40)).toBe(false);
    expect(roomTooSmall(50, 40)).toBe(false);
    expect(roomTooSmall(undefined, 40)).toBe(false);
    expect(roomTooSmall(30, Number.NaN)).toBe(false);
  });
});

describe('groupDropped', () => {
  it('lists the sections that lost each field, in a fixed order', () => {
    expect(
      groupDropped([
        { section: 'VI-A', field: 'teacher' },
        { section: 'XII-A', field: 'class' },
        { section: 'VI-A', field: 'room' },
        { section: 'VII-B', field: 'teacher' },
      ]),
    ).toEqual([
      { field: 'class', sections: ['XII-A'] },
      { field: 'room', sections: ['VI-A'] },
      { field: 'teacher', sections: ['VI-A', 'VII-B'] },
    ]);
  });

  it('is empty when nothing was dropped', () => {
    expect(groupDropped([])).toEqual([]);
  });
});

describe('sectionErrorField', () => {
  const refused = (problem: Record<string, unknown>) =>
    new ApiError(409, { title: 'Refused', status: 409, ...problem } as never);

  it('puts each refusal on the field it is about', () => {
    expect(sectionErrorField(refused({ type: 'name-taken', field: 'name' }))).toBe('name');
    expect(sectionErrorField(refused({ type: 'teacher-taken', sectionName: 'VI-A' }))).toBe(
      'classTeacherMembershipId',
    );
    expect(sectionErrorField(refused({ type: 'teacher-unavailable' }))).toBe(
      'classTeacherMembershipId',
    );
    expect(sectionErrorField(refused({ type: 'room-campus-mismatch' }))).toBe('roomId');
    expect(sectionErrorField(refused({ type: 'room-archived' }))).toBe('roomId');
    expect(sectionErrorField(refused({ type: 'stream-required' }))).toBe('streamId');
    expect(sectionErrorField(refused({ type: 'stream-archived' }))).toBe('streamId');
  });

  it("honours the problem's field, or its first error path", () => {
    expect(sectionErrorField(refused({ type: 'name-taken', field: 'roomId' }))).toBe('roomId');
    expect(
      sectionErrorField(
        refused({ type: 'about:blank', status: 422, errors: [{ path: 'roomId', message: 'x' }] }),
      ),
    ).toBe('roomId');
  });

  it('is null for a refusal about no one field', () => {
    expect(sectionErrorField(refused({ type: 'academic-year-locked' }))).toBeNull();
    expect(sectionErrorField(refused({ type: 'name-taken', field: 'code' }))).toBeNull();
    expect(sectionErrorField(new Error('offline'))).toBeNull();
  });
});

describe('leadsAnotherSection', () => {
  const asha = { membershipId: 'm-asha', sectionName: 'VI-A' };

  it('is false for the teacher of the section being edited', () => {
    expect(leadsAnotherSection(asha, 'm-asha')).toBe(false);
  });

  it('is true for a teacher who leads a section with the same label on another campus', () => {
    // Editing VI-A on Campus 1, led by someone else; Asha leads VI-A on Campus 2.
    expect(leadsAnotherSection(asha, 'm-ravi')).toBe(true);
    expect(leadsAnotherSection(asha, null)).toBe(true);
  });

  it('is false for a teacher who leads no section', () => {
    expect(leadsAnotherSection({ membershipId: 'm-ravi', sectionName: null }, null)).toBe(false);
  });
});

describe('copyableCount', () => {
  const sections = [section('VI', 'A'), section('VI', 'B'), section('XI', 'A')];

  it('counts only the sections whose class is in the range', () => {
    expect(copyableCount(sections, { lowest: 'VI', highest: 'X' })).toBe(2);
    expect(copyableCount(sections, { lowest: 'VI', highest: 'XII' })).toBe(3);
  });

  it('is 0 when every class is outside the range, or no range is set', () => {
    expect(copyableCount(sections, { lowest: 'I', highest: 'V' })).toBe(0);
    expect(copyableCount(sections, { lowest: null, highest: null })).toBe(0);
  });
});
