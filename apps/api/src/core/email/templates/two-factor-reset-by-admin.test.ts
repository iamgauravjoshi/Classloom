import { twoFactorResetByAdminEmail } from './two-factor-reset-by-admin';

const input = {
  schoolName: 'Global International School',
  at: new Date('2026-11-01T09:45:00Z'),
  securityUrl: 'http://localhost:3000/en/account/security',
};

describe('twoFactorResetByAdminEmail', () => {
  it('says the school admin turned two-step off', () => {
    const { subject, html, text } = twoFactorResetByAdminEmail(input);
    expect(subject).toBe('Your school turned off two-step sign-in');
    expect(text.startsWith(subject)).toBe(true);
    for (const part of [html, text]) {
      expect(part).toContain('An admin at Global International School turned off two-step');
    }
    expect(html).toContain('<h1');
  });

  it('shows the school, the IST time and links to Security settings', () => {
    const { html, text } = twoFactorResetByAdminEmail(input);
    for (const part of [html, text]) {
      expect(part).toContain('01/11/2026');
      expect(part).toContain('15:15 IST');
      expect(part).toContain('Global International School');
    }
    expect(text).toContain(input.securityUrl);
    expect(html).toContain(`href="${input.securityUrl}"`);
  });

  it('escapes the school name in HTML', () => {
    const { html } = twoFactorResetByAdminEmail({ ...input, schoolName: '<b>Evil</b> & Co' });
    expect(html).not.toContain('<b>Evil</b>');
    expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt; &amp; Co');
  });
});
