import { ApiError } from '@classloom/api-client';
import { describe, expect, it } from 'vitest';

import {
  allStreamsKind,
  canAddCell,
  classRowsOf,
  gridClasses,
  gridColumns,
  type LevelRow,
  nextKind,
  refusedField,
  refusedRow,
  rowsForClass,
  sameClassRows,
  toCellMap,
  withCell,
} from './class-subjects-helpers';

const MATHS = '00000000-0000-4000-8000-000000000001';
const PHYSICS = '00000000-0000-4000-8000-000000000002';
const ENGLISH = '00000000-0000-4000-8000-000000000003';
const SCIENCE = '00000000-0000-4000-8000-0000000000a1';
const COMMERCE = '00000000-0000-4000-8000-0000000000a2';

const ROWS: LevelRow[] = [
  { classLevel: 'X', subjectId: MATHS, streamId: null, kind: 'COMPULSORY' },
  { classLevel: 'X', subjectId: ENGLISH, streamId: null, kind: 'OPTIONAL' },
  { classLevel: 'XI', subjectId: ENGLISH, streamId: null, kind: 'COMPULSORY' },
  { classLevel: 'XI', subjectId: PHYSICS, streamId: SCIENCE, kind: 'COMPULSORY' },
  { classLevel: 'XI', subjectId: MATHS, streamId: COMMERCE, kind: 'OPTIONAL' },
];

const sorted = <T extends { subjectId: string; streamId: string | null }>(rows: readonly T[]) =>
  [...rows].sort(
    (a, b) =>
      a.subjectId.localeCompare(b.subjectId) || (a.streamId ?? '').localeCompare(b.streamId ?? ''),
  );

describe('rowsForClass', () => {
  it('round-trips each class through toCellMap', () => {
    const map = toCellMap(ROWS);
    for (const level of ['X', 'XI'] as const) {
      const expected = ROWS.filter((row) => row.classLevel === level).map(
        ({ classLevel: _level, ...row }) => row,
      );
      expect(sorted(rowsForClass(map, level))).toEqual(sorted(expected));
    }
    expect(rowsForClass(map, 'IX')).toEqual([]);
  });

  it('lists the rows in a stable order, all-streams rows first', () => {
    const map = toCellMap([...ROWS].reverse());
    expect(rowsForClass(map, 'XI')).toEqual(rowsForClass(toCellMap(ROWS), 'XI'));
    const xi = rowsForClass(map, 'XI');
    expect(xi[0]).toEqual({ subjectId: ENGLISH, streamId: null, kind: 'COMPULSORY' });
  });
});

describe('withCell', () => {
  it('sets a cell under a stream without touching the all-streams row for that subject', () => {
    const map = toCellMap(ROWS);
    const next = withCell(map, 'XI', SCIENCE, ENGLISH, 'OPTIONAL');
    const rows = rowsForClass(next, 'XI');
    expect(rows).toContainEqual({ subjectId: ENGLISH, streamId: null, kind: 'COMPULSORY' });
    expect(rows).toContainEqual({ subjectId: ENGLISH, streamId: SCIENCE, kind: 'OPTIONAL' });
    // Cleared again, the all-streams row is still there.
    const cleared = withCell(next, 'XI', SCIENCE, ENGLISH, undefined);
    expect(rowsForClass(cleared, 'XI')).toContainEqual({
      subjectId: ENGLISH,
      streamId: null,
      kind: 'COMPULSORY',
    });
    expect(sameClassRows(cleared, map, 'XI')).toBe(true);
  });

  it('leaves the original map and other classes alone', () => {
    const map = toCellMap(ROWS);
    const next = withCell(map, 'X', null, MATHS, undefined);
    expect(rowsForClass(map, 'X')).toHaveLength(2);
    expect(rowsForClass(next, 'X')).toHaveLength(1);
    expect(sameClassRows(next, map, 'XI')).toBe(true);
    expect(sameClassRows(next, map, 'X')).toBe(false);
  });
});

describe('nextKind', () => {
  it('cycles none, compulsory, optional and back to none', () => {
    expect(nextKind(undefined)).toBe('COMPULSORY');
    expect(nextKind('COMPULSORY')).toBe('OPTIONAL');
    expect(nextKind('OPTIONAL')).toBeUndefined();
  });
});

describe('classRowsOf', () => {
  it('flattens the API response into rows with their class', () => {
    expect(
      classRowsOf([
        {
          classLevel: 'X',
          outsideRange: false,
          rows: [{ subjectId: MATHS, streamId: null, kind: 'OPTIONAL' }],
        },
      ]),
    ).toEqual([{ classLevel: 'X', subjectId: MATHS, streamId: null, kind: 'OPTIONAL' }]);
  });
});

describe('gridClasses', () => {
  it('lists the in-range classes, then out-of-range classes that still have rows', () => {
    expect(
      gridClasses({ lowest: 'IX', highest: 'X' }, [
        { classLevel: 'XI', outsideRange: true, rows: [ROWS[2]!] },
        { classLevel: 'XII', outsideRange: true, rows: [] },
      ]),
    ).toEqual([
      { classLevel: 'IX', outsideRange: false },
      { classLevel: 'X', outsideRange: false },
      { classLevel: 'XI', outsideRange: true },
    ]);
  });
});

describe('gridColumns', () => {
  const subject = (id: string, name: string, status: 'ACTIVE' | 'ARCHIVED') => ({
    id,
    name,
    status,
  });

  it('takes the active subjects and the archived ones a class still has', () => {
    const subjects = [
      subject(MATHS, 'Mathematics', 'ACTIVE'),
      subject(PHYSICS, 'Physics', 'ARCHIVED'),
      subject(ENGLISH, 'English', 'ARCHIVED'),
    ];
    const map = toCellMap(ROWS.filter((row) => row.subjectId !== ENGLISH));
    expect(gridColumns(subjects, map).map((s) => s.name)).toEqual(['Mathematics', 'Physics']);
  });
});

describe('allStreamsKind', () => {
  const map = toCellMap(ROWS);

  it("gives a stream's view the kind the subject has for all streams", () => {
    expect(allStreamsKind(map, 'XI', SCIENCE, ENGLISH)).toBe('COMPULSORY');
    expect(allStreamsKind(map, 'XI', COMMERCE, ENGLISH)).toBe('COMPULSORY');
    const optional = withCell(map, 'XI', null, ENGLISH, 'OPTIONAL');
    expect(allStreamsKind(optional, 'XI', SCIENCE, ENGLISH)).toBe('OPTIONAL');
  });

  it('is undefined for a subject with no all-streams row, or in the all-streams view', () => {
    expect(allStreamsKind(map, 'XI', SCIENCE, PHYSICS)).toBeUndefined();
    expect(allStreamsKind(map, 'XI', null, ENGLISH)).toBeUndefined();
    expect(allStreamsKind(map, 'XII', SCIENCE, ENGLISH)).toBeUndefined();
  });
});

describe('canAddCell', () => {
  it('lets an archived subject or stream stay only in a class that already has it', () => {
    const saved = toCellMap(ROWS);
    const archived = new Set([PHYSICS, COMMERCE]);
    // Physics (archived) is in XI already, under Science; it may move to another stream there.
    expect(canAddCell(saved, 'XI', null, PHYSICS, archived)).toBe(true);
    expect(canAddCell(saved, 'X', null, PHYSICS, archived)).toBe(false);
    // Commerce (archived) is in XI already, not in XII.
    expect(canAddCell(saved, 'XI', COMMERCE, ENGLISH, archived)).toBe(true);
    expect(canAddCell(saved, 'XII', COMMERCE, ENGLISH, archived)).toBe(false);
    expect(canAddCell(saved, 'IX', null, MATHS, archived)).toBe(true);
  });
});

describe('refusedRow', () => {
  it('finds the row a refusal points at', () => {
    const rows = rowsForClass(toCellMap(ROWS), 'XI');
    const error = new ApiError(422, {
      type: 'subject-archived',
      title: 'Archived',
      status: 422,
      errors: [{ path: 'rows.1.subjectId', message: 'Archived' }],
    });
    expect(refusedRow(error, rows)).toEqual(rows[1]);
    expect(refusedRow(new Error('x'), rows)).toBeNull();
  });
});

describe('refusedField', () => {
  const refusal = (path: string) =>
    new ApiError(422, {
      type: 'stream-archived',
      title: 'Archived',
      status: 422,
      errors: [{ path, message: 'Archived' }],
    });

  it('names the stream for a stream refusal and the subject for a subject one', () => {
    expect(refusedField(refusal('rows.2.streamId'))).toBe('streamId');
    expect(refusedField(refusal('rows.0.subjectId'))).toBe('subjectId');
    expect(refusedField(refusal('rows'))).toBeNull();
    expect(refusedField(new Error('x'))).toBeNull();
  });
});
