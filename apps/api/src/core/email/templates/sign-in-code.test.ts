import { signInCodeEmail } from './sign-in-code';

const input = { schoolName: 'Global International School', code: '482913', minutes: 10 };

describe('signInCodeEmail', () => {
  it('puts the code in the subject', () => {
    expect(signInCodeEmail(input).subject).toBe('482913 is your Classloom sign-in code');
  });

  it('shows the code, school and expiry in both parts', () => {
    const { html, text } = signInCodeEmail(input);
    for (const part of [html, text]) {
      expect(part).toContain('482913');
      expect(part).toContain('Global International School');
      expect(part).toContain('Expires in 10 minutes');
    }
    expect(html).toContain('#3D5EE1');
  });

  it('tells a reader who did not ask that they can ignore the email', () => {
    const { html, text } = signInCodeEmail(input);
    const line = "If you didn't try to sign in, you can ignore this email; your account is safe.";
    expect(text).toContain(line);
    expect(html).toContain(line.replace("'", '&#39;'));
  });

  it('escapes the school name in HTML only', () => {
    const { html, text } = signInCodeEmail({ ...input, schoolName: '<b>x</b>' });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
    expect(text).toContain('<b>x</b>');
  });
});
