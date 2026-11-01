import { passwordChangedEmail } from './password-changed';

const input = {
  at: new Date('2026-11-01T09:45:00Z'),
  forgotUrl: 'http://localhost:3000/en/forgot-password',
};

describe('passwordChangedEmail', () => {
  it('has the password changed subject', () => {
    expect(passwordChangedEmail(input).subject).toBe('Your Classloom password was changed');
  });

  it('shows the IST time in both parts', () => {
    const { html, text } = passwordChangedEmail(input);
    for (const part of [html, text]) {
      expect(part).toContain('01/11/2026');
      expect(part).toContain('15:15 IST');
    }
    expect(html).toContain('#3D5EE1');
  });

  it('tells a reader who did not do it to reset the password, with the forgot-password link', () => {
    const { html, text } = passwordChangedEmail(input);
    expect(text).toContain("If this wasn't you, reset your password now.");
    expect(text).toContain(input.forgotUrl);
    expect(html).toContain(`href="${input.forgotUrl}"`);
    expect(html).toContain('If this wasn&#39;t you, reset your password now.');
  });
});
