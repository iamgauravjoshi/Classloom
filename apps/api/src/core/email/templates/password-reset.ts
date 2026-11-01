import messages from '../../../../messages/en.json';
import type { EmailMessage } from '../email-sender';

const BRAND = '#3D5EE1';
const copy = messages.email.passwordReset;

export interface PasswordResetInput {
  link: string;
  minutes: number;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

export function passwordResetEmail(input: PasswordResetInput): Omit<EmailMessage, 'to'> {
  const expiry = fill(copy.expiry, { minutes: String(input.minutes) });
  const link = escapeHtml(input.link);

  const text = [
    copy.heading,
    '',
    copy.intro,
    '',
    `${copy.button}: ${input.link}`,
    '',
    expiry,
    '',
    copy.ignore,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background-color:#F4F6FB;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F6FB;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-radius:8px;font-family:Arial,Helvetica,sans-serif;color:#1F2937;">
<tr><td style="background-color:${BRAND};padding:20px 28px;border-radius:8px 8px 0 0;color:#FFFFFF;font-size:20px;font-weight:bold;">Classloom</td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 16px 0;font-size:20px;color:#111827;">${escapeHtml(copy.heading)}</h1>
<p style="margin:0 0 20px 0;font-size:15px;line-height:22px;">${escapeHtml(copy.intro)}</p>
<p style="margin:0 0 24px 0;"><a href="${link}" style="display:inline-block;background-color:${BRAND};color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 24px;border-radius:6px;">${escapeHtml(copy.button)}</a></p>
<p style="margin:0 0 4px 0;font-size:13px;color:#6B7280;">${escapeHtml(copy.linkLabel)}</p>
<p style="margin:0 0 20px 0;font-size:13px;word-break:break-all;"><a href="${link}" style="color:${BRAND};">${link}</a></p>
<p style="margin:0 0 12px 0;font-size:13px;color:#6B7280;">${escapeHtml(expiry)}</p>
<p style="margin:0;font-size:13px;color:#6B7280;">${escapeHtml(copy.ignore)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject: copy.subject, html, text };
}
