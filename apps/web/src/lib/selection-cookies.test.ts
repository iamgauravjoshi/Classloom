import { afterEach, describe, expect, it, vi } from 'vitest';

import { pickCampus, pickYear, readSelection, writeSelection } from './selection-cookies';

const year = (id: string, status: 'PLANNED' | 'CURRENT' | 'CLOSED') => ({ id, status });
const campus = (id: string, isPrimary: boolean, isActive = true) => ({ id, isPrimary, isActive });

describe('pickYear', () => {
  const years = [year('y-next', 'PLANNED'), year('y-now', 'CURRENT'), year('y-old', 'CLOSED')];

  it("picks the cookie's year when the school has it", () => {
    expect(pickYear(years, 'y-old')?.id).toBe('y-old');
    expect(pickYear(years, 'y-next')?.id).toBe('y-next');
  });

  it('falls back to the current year without a cookie', () => {
    expect(pickYear(years, undefined)?.id).toBe('y-now');
  });

  it('falls back to the current year for an unknown id or one from another school', () => {
    expect(pickYear(years, 'deleted-year')?.id).toBe('y-now');
    // Another school's year id is simply not in this school's list.
    expect(pickYear(years, 'other-school-year')?.id).toBe('y-now');
    expect(pickYear(years, '')?.id).toBe('y-now');
  });

  it('gives null when the school has no years', () => {
    expect(pickYear([], 'y-now')).toBeNull();
    expect(pickYear([], undefined)).toBeNull();
  });

  it('gives null when no year is current and the cookie matches none', () => {
    expect(pickYear([year('y-next', 'PLANNED')], 'nope')).toBeNull();
  });
});

describe('pickCampus', () => {
  const campuses = [campus('main', true), campus('north', false), campus('old', false, false)];

  it("picks the cookie's campus when it is listed and active", () => {
    expect(pickCampus(campuses, 'north')?.id).toBe('north');
  });

  it('falls back to the primary campus for an inactive campus', () => {
    expect(pickCampus(campuses, 'old')?.id).toBe('main');
  });

  it('falls back to the primary campus without a cookie or for an unknown id', () => {
    expect(pickCampus(campuses, undefined)?.id).toBe('main');
    expect(pickCampus(campuses, 'other-school-campus')?.id).toBe('main');
  });

  it('gives null when there are no campuses', () => {
    expect(pickCampus([], 'main')).toBeNull();
  });
});

describe('writeSelection and readSelection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes a site-wide, one-year, Lax cookie (Secure on https)', () => {
    const written: string[] = [];
    vi.stubGlobal('location', { protocol: 'https:' });
    vi.stubGlobal('document', {
      set cookie(value: string) {
        written.push(value);
      },
    });
    writeSelection('cl_year', 'y-now');
    expect(written).toEqual(['cl_year=y-now; Path=/; Max-Age=31536000; SameSite=Lax; Secure']);
  });

  it('leaves Secure off on plain http (local development)', () => {
    const written: string[] = [];
    vi.stubGlobal('location', { protocol: 'http:' });
    vi.stubGlobal('document', {
      set cookie(value: string) {
        written.push(value);
      },
    });
    writeSelection('cl_campus', 'a b');
    expect(written).toEqual(['cl_campus=a%20b; Path=/; Max-Age=31536000; SameSite=Lax']);
  });

  it('reads a cookie by name, decoded, or undefined', () => {
    vi.stubGlobal('document', { cookie: 'sidebar_state=true; cl_campus=a%20b; cl_year=y1' });
    expect(readSelection('cl_campus')).toBe('a b');
    expect(readSelection('cl_year')).toBe('y1');
    vi.stubGlobal('document', { cookie: 'xcl_year=nope' });
    expect(readSelection('cl_year')).toBeUndefined();
  });
});
