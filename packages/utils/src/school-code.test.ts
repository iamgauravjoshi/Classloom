import { describe, expect, it } from 'vitest';

import {
  normaliseSchoolCode,
  RESERVED_SCHOOL_CODES,
  suggestSchoolCode,
  validateSchoolCode,
} from './school-code';

describe('normaliseSchoolCode', () => {
  it('trims and uppercases', () => {
    expect(normaliseSchoolCode(' gisd ')).toBe('GISD');
  });
});

describe('validateSchoolCode', () => {
  it('accepts and normalises a valid code', () => {
    expect(validateSchoolCode(' gisd ')).toEqual({ ok: true, code: 'GISD' });
  });

  it.each(['GI', 'ABCDEFGHIJKLM', '1ABC', 'AB-', 'A--B', 'AB C', 'AB_C'])(
    'rejects %s as invalid',
    (bad) => {
      expect(validateSchoolCode(bad)).toMatchObject({ ok: false, problem: 'invalid' });
    },
  );

  it('rejects reserved codes case-insensitively', () => {
    expect(validateSchoolCode('admin')).toEqual({ ok: false, code: 'ADMIN', problem: 'reserved' });
  });

  it('accepts a hyphenated code', () => {
    expect(validateSchoolCode('DPS-RKP')).toMatchObject({ ok: true });
  });

  it('accepts the 3- and 12-character length limits', () => {
    expect(validateSchoolCode('ABC')).toMatchObject({ ok: true });
    expect(validateSchoolCode('ABCDEFGHIJKL')).toMatchObject({ ok: true });
  });

  it('reserves every code listed in the spec', () => {
    for (const code of RESERVED_SCHOOL_CODES) {
      expect(validateSchoolCode(code)).toMatchObject({ ok: false, problem: 'reserved' });
    }
  });
});

describe('suggestSchoolCode', () => {
  it('uses initials of name words plus the city initial', () => {
    expect(suggestSchoolCode('Global International School', 'Dehradun')).toBe('GISD');
    expect(suggestSchoolCode("St. Mary's Convent", 'Nainital')).toBe('SMCN');
    expect(suggestSchoolCode('Kendriya Vidyalaya', 'Roorkee')).toBe('KVR');
  });

  it('skips the joining words of, the, and, &', () => {
    expect(suggestSchoolCode('The School of Arts and Science', 'Agra')).toBe('SASA');
    expect(suggestSchoolCode('Arts & Crafts', 'Agra')).toBe('ACA');
  });

  it('pads with letters of the first word when there are fewer than 3 letters', () => {
    expect(suggestSchoolCode('Academy', 'Pune')).toBe('ACP');
  });

  it('handles non-Latin names', () => {
    for (const [name, city] of [
      ['सरस्वती विद्या मंदिर', 'देहरादून'],
      ['சரஸ்வதி பள்ளி', 'Chennai'],
      ['', ''],
    ] as const) {
      expect(validateSchoolCode(suggestSchoolCode(name, city)).ok).toBe(true);
    }
  });

  it('uses the first Latin letters of the city when the name has none', () => {
    expect(suggestSchoolCode('सरस्वती विद्या मंदिर', 'Chennai')).toBe('CHE');
  });

  it('falls back to SCH when neither name nor city has Latin letters', () => {
    expect(suggestSchoolCode('', '')).toBe('SCH');
  });

  it('appends -1 when the suggestion is reserved', () => {
    expect(suggestSchoolCode('Api', '')).toBe('API-1');
  });

  it('always returns a code that passes validation', () => {
    const samples: [string, string][] = [
      ['Admin', ''],
      ['Test', 'Demo'],
      ['A', ''],
      ['Ab', 'C'],
      ['Extraordinarily Long Multi Word Institution Name Here', 'Dehradun'],
      ['!!!', '??'],
    ];
    for (const [name, city] of samples) {
      expect(validateSchoolCode(suggestSchoolCode(name, city)).ok).toBe(true);
    }
  });

  it('caps the suggestion at 12 characters', () => {
    expect(
      suggestSchoolCode(
        'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu',
        'Pune',
      ),
    ).toBe('ABGDEZETIKLM');
  });
});
