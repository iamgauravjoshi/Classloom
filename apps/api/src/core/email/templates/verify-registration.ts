import { formatDateIN } from '@classloom/utils';

import messages from '../../../../messages/en.json';
import type { EmailMessage } from '../email-sender';

const BRAND = '#3D5EE1';
const copy = messages.email.verifyRegistration;

export interface VerifyRegistrationInput {
  schoolName: string;
  code: string;
  verifyUrl: string;
  expiresAt: Date;
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

function timeIN(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function verifyRegistrationEmail(input: VerifyRegistrationInput): Omit<EmailMessage, 'to'> {
  const expiryLine = fill(copy.expiry, {
    date: formatDateIN(input.expiresAt),
    time: timeIN(input.expiresAt),
  });
  const url = escapeHtml(input.verifyUrl);

  const text = [
    copy.heading,
    '',
    fill(copy.intro, { schoolName: input.schoolName }),
    '',
    `${copy.codeLabel}: ${input.code}`,
    '',
    `${copy.button}: ${input.verifyUrl}`,
    '',
    expiryLine,
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
<p style="margin:0 0 20px 0;font-size:15px;line-height:22px;">${escapeHtml(fill(copy.intro, { schoolName: input.schoolName }))}</p>
<p style="margin:0 0 8px 0;font-size:13px;color:#6B7280;">${escapeHtml(copy.codeLabel)}</p>
<p style="margin:0 0 24px 0;font-size:28px;letter-spacing:6px;font-weight:bold;color:${BRAND};">${escapeHtml(input.code)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:${BRAND};border-radius:6px;"><a href="${url}" style="display:inline-block;padding:12px 24px;color:#FFFFFF;font-size:15px;font-weight:bold;text-decoration:none;">${escapeHtml(copy.button)}</a></td></tr></table>
<p style="margin:20px 0 4px 0;font-size:13px;color:#6B7280;">${escapeHtml(copy.linkFallback)}</p>
<p style="margin:0 0 20px 0;font-size:13px;word-break:break-all;"><a href="${url}" style="color:${BRAND};">${url}</a></p>
<p style="margin:0 0 12px 0;font-size:13px;color:#6B7280;">${escapeHtml(expiryLine)}</p>
<p style="margin:0;font-size:13px;color:#6B7280;">${escapeHtml(copy.ignore)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject: copy.subject, html, text };
}
