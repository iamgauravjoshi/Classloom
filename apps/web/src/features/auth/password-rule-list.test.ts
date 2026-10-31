import { describe, expect, it } from 'vitest';

import { passwordRuleList } from './password-rule-list';

const t = (key: string) => `[${key}]`;

describe('passwordRuleList', () => {
  it('lists the length rule with its translated label', () => {
    expect(passwordRuleList('', t)).toEqual([{ label: '[length]', met: false }]);
  });

  it('marks length unmet at 9 characters and met at 10', () => {
    expect(passwordRuleList('a'.repeat(9), t)[0]?.met).toBe(false);
    expect(passwordRuleList('a'.repeat(10), t)[0]?.met).toBe(true);
  });

  it('marks length met at 128 characters and unmet at 129', () => {
    expect(passwordRuleList('a'.repeat(128), t)[0]?.met).toBe(true);
    expect(passwordRuleList('a'.repeat(129), t)[0]?.met).toBe(false);
  });

  it('counts spaces like any other character (no trimming)', () => {
    expect(passwordRuleList('  four  words  ', t)[0]?.met).toBe(true);
  });
});
