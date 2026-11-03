import { describe, expect, it } from 'vitest';

import {
  checkTerms,
  defaultTerms,
  nextYearDates,
  yearLabel,
  yearLengthOk,
} from './academic-calendar';

const T = (name: string, startsOn: string, endsOn: string) => ({ name, startsOn, endsOn });

describe('defaultTerms', () => {
  it('splits April–March into two', () => {
    expect(defaultTerms('2026-04-01', '2027-03-31', 2)).toEqual([
      T('Term 1', '2026-04-01', '2026-09-30'),
      T('Term 2', '2026-10-01', '2027-03-31'),
    ]);
  });
  it('splits April–March into three', () => {
    expect(defaultTerms('2026-04-01', '2027-03-31', 3)).toEqual([
      T('Term 1', '2026-04-01', '2026-07-31'),
      T('Term 2', '2026-08-01', '2026-11-30'),
      T('Term 3', '2026-12-01', '2027-03-31'),
    ]);
  });
  it('splits June–May into three', () => {
    expect(defaultTerms('2026-06-01', '2027-05-31', 3)).toEqual([
      T('Term 1', '2026-06-01', '2026-09-30'),
      T('Term 2', '2026-10-01', '2027-01-31'),
      T('Term 3', '2027-02-01', '2027-05-31'),
    ]);
  });
  it('gives the extra month to earlier terms for a 13-month year', () => {
    expect(defaultTerms('2026-04-01', '2027-04-30', 2)).toEqual([
      T('Term 1', '2026-04-01', '2026-10-31'),
      T('Term 2', '2026-11-01', '2027-04-30'),
    ]);
  });
  it('produces tiling terms', () => {
    const y = { startsOn: '2026-04-01', endsOn: '2027-03-31' };
    for (const n of [2, 3] as const) {
      expect(checkTerms(y, defaultTerms(y.startsOn, y.endsOn, n))).toEqual({ ok: true });
    }
    const odd = { startsOn: '2026-04-01', endsOn: '2027-04-30' };
    expect(checkTerms(odd, defaultTerms(odd.startsOn, odd.endsOn, 2))).toEqual({ ok: true });
  });
});

describe('checkTerms', () => {
  const y = { startsOn: '2026-04-01', endsOn: '2027-03-31' };
  it('rejects 1 or 4 terms', () => {
    expect(checkTerms(y, [T('a', y.startsOn, y.endsOn)])).toMatchObject({
      ok: false,
      problem: 'count',
    });
    const four = [1, 2, 3, 4].map((i) => T(`t${i}`, y.startsOn, y.endsOn));
    expect(checkTerms(y, four)).toMatchObject({ ok: false, problem: 'count' });
  });
  it('flags a late start', () => {
    const r = checkTerms(y, [
      T('a', '2026-04-05', '2026-09-30'),
      T('b', '2026-10-01', '2027-03-31'),
    ]);
    expect(r).toEqual({ ok: false, index: 0, problem: 'start' });
  });
  it('flags a gap', () => {
    const r = checkTerms(y, [
      T('a', '2026-04-01', '2026-09-30'),
      T('b', '2026-10-02', '2027-03-31'),
    ]);
    expect(r).toEqual({ ok: false, index: 1, problem: 'gap' });
  });
  it('flags a term ending before it starts', () => {
    const r = checkTerms(y, [
      T('a', '2026-04-01', '2026-03-01'),
      T('b', '2026-03-02', '2027-03-31'),
    ]);
    expect(r).toEqual({ ok: false, index: 0, problem: 'order' });
  });
  it('flags a last term that stops early', () => {
    const r = checkTerms(y, [
      T('a', '2026-04-01', '2026-09-30'),
      T('b', '2026-10-01', '2027-03-30'),
    ]);
    expect(r).toEqual({ ok: false, index: 1, problem: 'end' });
  });
});

describe('yearLabel', () => {
  it('formats with an en dash', () => {
    expect(yearLabel('2026-04-01', '2027-03-31')).toBe('2026–27');
    expect(yearLabel('2099-04-01', '2100-03-31')).toBe('2099–00');
  });
  it('uses a single year within one calendar year', () => {
    expect(yearLabel('2026-01-01', '2026-12-31')).toBe('2026');
  });
});

describe('yearLengthOk', () => {
  // Length is the number of days from start to end.
  const end = (days: number) =>
    new Date(Date.UTC(2026, 0, 1) + days * 86_400_000).toISOString().slice(0, 10);
  it('accepts 180 to 400 days inclusive', () => {
    expect(yearLengthOk('2026-01-01', end(179))).toBe(false);
    expect(yearLengthOk('2026-01-01', end(180))).toBe(true);
    expect(yearLengthOk('2026-01-01', end(400))).toBe(true);
    expect(yearLengthOk('2026-01-01', end(401))).toBe(false);
  });
});

describe('nextYearDates', () => {
  it('rolls April–March forward', () => {
    expect(nextYearDates({ startsOn: '2026-04-01', endsOn: '2027-03-31' })).toEqual({
      startsOn: '2027-04-01',
      endsOn: '2028-03-31',
    });
  });
  it('rolls June–May forward', () => {
    expect(nextYearDates({ startsOn: '2026-06-01', endsOn: '2027-05-31' })).toEqual({
      startsOn: '2027-06-01',
      endsOn: '2028-05-31',
    });
  });
});
