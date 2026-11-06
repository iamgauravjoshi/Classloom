import { describe, expect, it } from 'vitest';

import { csvCell, istDateTime } from './audit-csv';
import { changesOf } from './audit-log.service';

describe('csvCell', () => {
  it.each([
    ['plain', 'plain'],
    ['a, b', '"a, b"'],
    ['say "hi"', '"say ""hi"""'],
    ['two\nlines', '"two\nlines"'],
    ['=1+1', "'=1+1"],
    ['+91 98765', "'+91 98765"],
    ['-2', "'-2"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['=HYPERLINK("x","y")', `"'=HYPERLINK(""x"",""y"")"`],
    ['', ''],
  ])('writes %j as %j', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });
});

describe('istDateTime', () => {
  it('shows IST as DD/MM/YYYY HH:mm, across midnight', () => {
    expect(istDateTime('2026-11-05T18:00:00.000Z')).toBe('05/11/2026 23:30');
    expect(istDateTime('2026-11-05T18:30:00.000Z')).toBe('06/11/2026 00:00');
  });
});

describe('changesOf', () => {
  it('lists only the keys whose values differ, a missing side as null', () => {
    expect(
      changesOf(
        { name: 'A', roleIds: ['x', 'y'], same: { a: 1, b: 2 } },
        { name: 'B', roleIds: ['x', 'y'], same: { b: 2, a: 1 }, added: true },
      ),
    ).toEqual([
      { field: 'name', before: 'A', after: 'B' },
      { field: 'added', before: null, after: true },
    ]);
  });

  it('handles a created and a deleted row', () => {
    expect(changesOf(null, { name: 'A' })).toEqual([{ field: 'name', before: null, after: 'A' }]);
    expect(changesOf({ name: 'A' }, null)).toEqual([{ field: 'name', before: 'A', after: null }]);
    expect(changesOf(null, null)).toEqual([]);
  });
});
