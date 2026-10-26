import { maskEmail } from './mask-email';

describe('maskEmail', () => {
  it('keeps the first character and the domain', () => {
    expect(maskEmail('asha@school.in')).toBe('a***@school.in');
  });

  it('masks a one-character local part fully', () => {
    expect(maskEmail('a@school.in')).toBe('*@school.in');
  });

  it('splits on the last @', () => {
    expect(maskEmail('weird@name@school.in')).toBe('w***@school.in');
  });
});
