import { describe, expect, it } from 'vitest';

import { formatDateTime, formatDay, groupKey } from './format';

describe('groupKey', () => {
  it('splits the key into groups of four', () => {
    expect(groupKey('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toBe(
      'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP',
    );
  });

  it('leaves a short last group', () => {
    expect(groupKey('ABCDEF')).toBe('ABCD EF');
    expect(groupKey('')).toBe('');
  });
});

describe('dates', () => {
  const at = '2026-11-01T20:00:00.000Z'; // 2 Nov, 01:30 in India

  it('formats a day as "2 Nov 2026" in the given time zone', () => {
    expect(formatDay(at, 'Asia/Kolkata')).toBe('2 Nov 2026');
    expect(formatDay(at, 'UTC')).toBe('1 Nov 2026');
  });

  it('formats a moment with the time', () => {
    expect(formatDateTime(at, 'Asia/Kolkata')).toMatch(/^2 Nov 2026, 1:30\s?am$/i);
  });
});
