import { describe, expect, it } from 'vitest';

import { generateRecoveryCodes, hashRecoveryCode, normaliseRecoveryCode } from './recovery-codes';

describe('generateRecoveryCodes', () => {
  it('returns 10 unique XXXXX-XXXXX codes from the Crockford alphabet', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  });
});

describe('normaliseRecoveryCode', () => {
  it('uppercases and strips hyphens and spaces', () => {
    expect(normaliseRecoveryCode(' abcde-fghjk ')).toBe('ABCDEFGHJK');
    expect(normaliseRecoveryCode('abcde fghjk')).toBe('ABCDEFGHJK');
  });

  it('treats spaced, unhyphenated, lower-case and hyphenated forms as the same value', () => {
    const forms = ['abcde fghij', 'ABCDEFGHIJ', 'abcde-fghij'].map(normaliseRecoveryCode);
    expect(new Set(forms).size).toBe(1);
  });

  it('normalises every generated code to the code without its hyphen', () => {
    for (const c of generateRecoveryCodes()) {
      expect(normaliseRecoveryCode(c)).toBe(c.replace('-', ''));
    }
  });

  it('maps Crockford look-alikes (O to 0, I and L to 1)', () => {
    expect(normaliseRecoveryCode('oilOI-lo123')).toBe('0110110123');
  });
});

describe('hashRecoveryCode', () => {
  it('is stable hex and differs per secret', () => {
    const a = hashRecoveryCode('secret-a', 'ABCDEFGHJK');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode('secret-a', 'ABCDEFGHJK')).toBe(a);
    expect(hashRecoveryCode('secret-b', 'ABCDEFGHJK')).not.toBe(a);
    expect(hashRecoveryCode('secret-a', 'ABCDEFGHJM')).not.toBe(a);
  });
});
