import { passwordResetEmail } from './password-reset';

const link = 'http://localhost:3000/en/reset-password?token=abc_DEF-123';
const input = { link, minutes: 30 };

describe('passwordResetEmail', () => {
  it('has the reset subject', () => {
    expect(passwordResetEmail(input).subject).toBe('Reset your Classloom password');
  });

  it('shows the link and the 30-minute expiry in both parts', () => {
    const { html, text } = passwordResetEmail(input);
    for (const part of [html, text]) {
      expect(part).toContain(link);
      expect(part).toContain('Expires in 30 minutes');
    }
    expect(html).toContain(`href="${link}"`);
    expect(html).toContain('#3D5EE1');
  });

  it('tells a reader who did not ask that nothing changed', () => {
    const { html, text } = passwordResetEmail(input);
    const line = "If you didn't ask for this, ignore this email; your password hasn't changed.";
    expect(text).toContain(line);
    expect(html).toContain(line.replaceAll("'", '&#39;'));
  });

  it('escapes the link in HTML only', () => {
    const { html, text } = passwordResetEmail({ link: 'http://x.test/?a=1&b="2"', minutes: 30 });
    expect(html).toContain('a=1&amp;b=&quot;2&quot;');
    expect(text).toContain('a=1&b="2"');
  });
});
