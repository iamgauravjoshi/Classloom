import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SERIES,
  formatNumber,
  hasYearToken,
  NUMBER_SERIES_KEYS,
  numberSeriesSchema,
  parseNumberPattern,
  updateNumberSeriesRequestSchema,
} from './number-series';

function parts(pattern: string) {
  const r = parseNumberPattern(pattern);
  if (!r.ok) throw new Error(`unexpected ${r.problem}`);
  return r.parts;
}

describe('parseNumberPattern', () => {
  it('accepts a valid pattern', () => {
    expect(parseNumberPattern('ADM/{YY}/{SEQ:4}').ok).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['A'.repeat(36) + '{SEQ:4}', 'too-long'],
    ['A#{SEQ:3}', 'bad-character'],
    ['{FOO}{SEQ:2}', 'unknown-token'],
    ['ADM', 'seq-missing'],
    ['{SEQ:2}{SEQ:2}', 'seq-repeated'],
    ['{SEQ:0}', 'seq-width'],
    ['{SEQ:9}', 'seq-width'],
  ])('refuses %j as %s', (pattern, problem) => {
    expect(parseNumberPattern(pattern)).toEqual({ ok: false, problem });
  });

  it('counts exactly 40 characters as fine', () => {
    expect(parseNumberPattern('A'.repeat(32) + '{SEQ:8}').ok).toBe(true);
    expect('A'.repeat(36) + '{SEQ:4}').toHaveLength(43);
  });
});

describe('formatNumber', () => {
  it('formats a short year and zero-pads', () => {
    expect(formatNumber(parts('ADM/{YY}/{SEQ:4}'), { yearStart: 2026, sequence: 12 })).toBe(
      'ADM/26/0012',
    );
  });

  it('formats the academic year with an ASCII hyphen', () => {
    expect(formatNumber(parts('{AY}-{SEQ:1}'), { yearStart: 2026, sequence: 1 })).toBe('2026-27-1');
    expect(formatNumber(parts('{AY}/{SEQ:1}'), { yearStart: 2099, sequence: 1 })).toBe('2099-00/1');
    expect(formatNumber(parts('{YYYY}/{SEQ:2}'), { yearStart: 2026, sequence: 5 })).toBe('2026/05');
  });

  it('prints a longer counter in full', () => {
    expect(formatNumber(parts('{SEQ:3}'), { yearStart: 2026, sequence: 12345 })).toBe('12345');
  });
});

describe('hasYearToken', () => {
  it('detects year tokens', () => {
    expect(hasYearToken(parts('{SEQ:5}'))).toBe(false);
    expect(hasYearToken(parts('A/{YY}/{SEQ:5}'))).toBe(true);
    expect(hasYearToken(parts('{AY}/{SEQ:5}'))).toBe(true);
  });
});

describe('defaults and schemas', () => {
  it('parses every default pattern', () => {
    for (const key of NUMBER_SERIES_KEYS) {
      expect(parseNumberPattern(DEFAULT_SERIES[key].pattern).ok).toBe(true);
    }
    expect(DEFAULT_SERIES.ADMISSION).toEqual({ pattern: '{SEQ:5}', reset: 'NEVER' });
  });

  it('validates a series row', () => {
    expect(
      numberSeriesSchema.safeParse({
        key: 'ENQUIRY',
        name: 'Enquiry',
        pattern: 'ENQ/{AY}/{SEQ:4}',
        reset: 'ACADEMIC_YEAR',
        nextNumber: 1,
        preview: null,
      }).success,
    ).toBe(true);
  });

  it('requires a field and bounds nextNumber', () => {
    expect(updateNumberSeriesRequestSchema.safeParse({}).success).toBe(false);
    expect(updateNumberSeriesRequestSchema.safeParse({ nextNumber: 0 }).success).toBe(false);
    expect(updateNumberSeriesRequestSchema.safeParse({ nextNumber: 100_000_000 }).success).toBe(
      false,
    );
    expect(updateNumberSeriesRequestSchema.safeParse({ nextNumber: 99_999_999 }).success).toBe(
      true,
    );
    expect(updateNumberSeriesRequestSchema.safeParse({ reset: 'NEVER' }).success).toBe(true);
  });
});
