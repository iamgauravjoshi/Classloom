import { describe, expect, it } from 'vitest';

import { RECOVERY_CODES_FILENAME, recoveryCodesFile } from './recovery-codes-file';

const CODES = Array.from({ length: 10 }, (_, index) => `ABCDE-${String(index).padStart(5, '0')}`);

describe('recoveryCodesFile', () => {
  // 1 Nov 2026, 20:00 UTC is already 2 Nov in India.
  const createdAt = new Date('2026-11-01T20:00:00Z');
  const text = recoveryCodesFile(CODES, 'asha@example.com', createdAt);
  const lines = text.split('\n');

  it('starts with a header line naming the account and the date (India time)', () => {
    expect(lines[0]).toBe('Classloom recovery codes for asha@example.com, created 2026-11-02');
  });

  it('lists every code on a line of its own, in order', () => {
    const codeLines = lines.filter((line) => /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(line));
    expect(codeLines).toEqual(CODES);
    for (const code of CODES) expect(lines).toContain(code);
  });

  it('says each code works once, and ends with a newline', () => {
    expect(text).toContain('Each code can be used once.');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('names the download file', () => {
    expect(RECOVERY_CODES_FILENAME).toBe('classloom-recovery-codes.txt');
  });
});
