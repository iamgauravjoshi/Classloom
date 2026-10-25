import { describe, expect, it } from 'vitest';

import { formatINR } from './money';

describe('formatINR', () => {
  it('formats paise with Indian lakh grouping', () => {
    expect(formatINR(12345678)).toBe('₹1,23,456.78');
  });

  it('formats zero', () => {
    expect(formatINR(0)).toBe('₹0.00');
  });

  it('formats negative amounts (refunds) with a leading minus', () => {
    expect(formatINR(-50000)).toBe('-₹500.00');
  });

  it('groups crores', () => {
    expect(formatINR(1000000000)).toBe('₹1,00,00,000.00');
  });

  it('rounds to whole rupees when decimals are off', () => {
    expect(formatINR(12345678, { decimals: false })).toBe('₹1,23,457');
  });
});
