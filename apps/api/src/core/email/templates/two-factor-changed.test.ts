import { twoFactorChangedEmail } from './two-factor-changed';

const base = {
  at: new Date('2026-11-01T09:45:00Z'),
  securityUrl: 'http://localhost:3000/en/account/security',
};

describe('twoFactorChangedEmail', () => {
  it.each([
    ['ENABLED', 'Two-step sign-in was turned on'],
    ['DISABLED', 'Two-step sign-in was turned off'],
    ['CODES_REGENERATED', 'New recovery codes were created'],
  ] as const)('%s has its own subject and heading', (change, subject) => {
    const { subject: got, html, text } = twoFactorChangedEmail({ ...base, change });
    expect(got).toBe(subject);
    expect(text.startsWith(subject)).toBe(true);
    expect(html).toContain(`<h1`);
    expect(html).toContain(subject);
  });

  it('shows the IST time and links to Security settings', () => {
    const { html, text } = twoFactorChangedEmail({ ...base, change: 'ENABLED' });
    for (const part of [html, text]) {
      expect(part).toContain('01/11/2026');
      expect(part).toContain('15:15 IST');
    }
    expect(text).toContain("If this wasn't you, change your password and check Security settings.");
    expect(text).toContain(base.securityUrl);
    expect(html).toContain(`href="${base.securityUrl}"`);
  });
});
