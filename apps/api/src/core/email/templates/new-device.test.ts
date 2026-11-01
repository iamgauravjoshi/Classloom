import { newDeviceEmail } from './new-device';

const input = {
  schoolName: 'Global International School',
  device: 'Chrome on Windows',
  ip: '203.0.113.7',
  at: new Date('2026-11-01T09:45:00Z'),
  securityUrl: 'http://localhost:3000/en/account/security',
};

describe('newDeviceEmail', () => {
  it('has the new sign-in subject', () => {
    expect(newDeviceEmail(input).subject).toBe('New sign-in to your Classloom account');
  });

  it('shows the school, device, IP and IST time in both parts', () => {
    const { html, text } = newDeviceEmail(input);
    for (const part of [html, text]) {
      expect(part).toContain('Global International School');
      expect(part).toContain('Chrome on Windows');
      expect(part).toContain('203.0.113.7');
      expect(part).toContain('01/11/2026');
      expect(part).toContain('15:15 IST');
    }
    expect(html).toContain('#3D5EE1');
  });

  it('tells a reader who did not sign in what to do, with the security link', () => {
    const { html, text } = newDeviceEmail(input);
    const line =
      "If this wasn't you, change your password and end the session from Security settings.";
    expect(text).toContain(line);
    expect(text).toContain(input.securityUrl);
    expect(html).toContain(line.replaceAll("'", '&#39;'));
    expect(html).toContain(`href="${input.securityUrl}"`);
  });

  it('shows "Unknown" when there is no IP', () => {
    const { text } = newDeviceEmail({ ...input, ip: undefined });
    expect(text).toContain('IP address: Unknown');
  });

  it('escapes the school name and device in HTML only', () => {
    const { html, text } = newDeviceEmail({ ...input, schoolName: '<b>x</b>', device: 'a&b' });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('a&amp;b');
    expect(text).toContain('<b>x</b>');
  });
});
