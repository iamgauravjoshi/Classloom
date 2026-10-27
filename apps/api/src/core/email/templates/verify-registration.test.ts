import { verifyRegistrationEmail } from './verify-registration';

const input = {
  schoolName: 'Global International School',
  code: 'GISD',
  verifyUrl: 'http://localhost:3000/register/verify?token=abc',
  expiresAt: new Date('2026-11-01T10:30:00Z'),
};

describe('verifyRegistrationEmail', () => {
  it('uses the registration subject', () => {
    expect(verifyRegistrationEmail(input).subject).toBe(
      'Verify your school registration on Classloom',
    );
  });

  it('includes the school, code, link, expiry in IST and the ignore notice in the text part', () => {
    const { text } = verifyRegistrationEmail(input);
    expect(text).toContain('Global International School');
    expect(text).toContain('GISD');
    expect(text).toContain(input.verifyUrl);
    expect(text).toContain('01/11/2026');
    expect(text).toContain('16:00 IST');
    expect(text).toContain("If you didn't register this school, you can ignore this email.");
  });

  it('renders a branded HTML part with the verification link', () => {
    const { html } = verifyRegistrationEmail(input);
    expect(html).toContain('#3D5EE1');
    expect(html).toContain(`<a href="${input.verifyUrl}"`);
    expect(html).toContain('GISD');
  });

  it('describes the code as the school code and the button as the way to confirm', () => {
    const { text, html } = verifyRegistrationEmail(input);
    for (const part of [text, html]) {
      expect(part).toContain('Confirm your email address with the button below.');
      expect(part).toContain('Your school code');
      expect(part).toContain('This link expires on 01/11/2026 at 16:00 IST.');
      expect(part).not.toMatch(/verification code|code below|This code and link/i);
    }
  });

  it('escapes interpolated values in HTML', () => {
    const { html, text } = verifyRegistrationEmail({ ...input, schoolName: '<script>' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(text).toContain('<script>');
  });

  it('escapes quotes in the verification URL attribute', () => {
    const { html } = verifyRegistrationEmail({ ...input, verifyUrl: 'http://x/?a="b"&c=1' });
    expect(html).toContain('href="http://x/?a=&quot;b&quot;&amp;c=1"');
  });
});
