import { describe, expect, it } from 'vitest';

import { academicYearOf, formatDateIN, toISTDateString } from './dates';

describe('formatDateIN', () => {
  it('renders DD/MM/YYYY in IST, crossing midnight from UTC', () => {
    expect(formatDateIN('2026-03-31T19:00:00Z')).toBe('01/04/2026');
  });

  it('accepts Date objects', () => {
    expect(formatDateIN(new Date('2026-08-15T00:00:00+05:30'))).toBe('15/08/2026');
  });
});

describe('toISTDateString', () => {
  it('returns the IST calendar date just before IST midnight', () => {
    expect(toISTDateString('2026-03-31T18:29:59Z')).toBe('2026-03-31');
  });
});

describe('academicYearOf', () => {
  it('starts the new April–March year at IST midnight on 1 April', () => {
    expect(academicYearOf('2026-03-31T19:00:00Z')).toBe('2026-27');
  });

  it('keeps 31 March IST in the previous year', () => {
    expect(academicYearOf('2026-03-31T18:29:59Z')).toBe('2025-26');
  });

  it('supports schools whose year starts in another month', () => {
    expect(academicYearOf('2026-06-15', 6)).toBe('2026-27');
    expect(academicYearOf('2026-05-31', 6)).toBe('2025-26');
  });

  it('formats century rollovers with two digits', () => {
    expect(academicYearOf('2099-12-01')).toBe('2099-00');
  });
});
