import { invitationEmail } from './invitation';

const input = {
  schoolName: 'Global International School',
  inviterName: 'Asha Rawat',
  roles: ['Teacher', 'Class Teacher'],
  joinUrl: 'http://localhost:3000/en/join?token=abc_DEF-123',
  // 9 Nov 2026 in India even though it is still 8 Nov in UTC.
  expiresAt: new Date('2026-11-08T20:00:00Z'),
};

describe('invitationEmail', () => {
  it('invites the person to the school by name', () => {
    const { subject, html, text } = invitationEmail(input);
    expect(subject).toBe("You're invited to join Global International School on Classloom");
    expect(text.startsWith(subject)).toBe(true);
    expect(html).toContain('<h1');
    for (const part of [html, text]) {
      expect(part).toContain('Asha Rawat invited you to join Global International School');
    }
  });

  it('lists the roles, the expiry date in India and the ignore line', () => {
    const { html, text } = invitationEmail(input);
    for (const part of [html, text]) {
      expect(part).toContain('Teacher, Class Teacher');
      expect(part).toContain('This invitation expires on 9 Nov 2026.');
    }
    expect(text).toContain("If you weren't expecting this, you can ignore it.");
    expect(html).toContain('If you weren&#39;t expecting this, you can ignore it.');
  });

  it('has a Join button and the plain link', () => {
    const { html, text } = invitationEmail(input);
    expect(text).toContain(`Join: ${input.joinUrl}`);
    expect(html).toContain(`href="${input.joinUrl}"`);
    expect(html).toContain('>Join</a>');
  });

  it('escapes names in HTML', () => {
    const { html } = invitationEmail({
      ...input,
      schoolName: '<b>Evil</b> & Co',
      inviterName: '<script>x</script>',
    });
    expect(html).not.toContain('<b>Evil</b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt; &amp; Co');
  });
});
