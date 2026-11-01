import { formatDateIN } from '@classloom/utils';

import messages from '../../../../messages/en.json';
import type { EmailMessage } from '../email-sender';

const BRAND = '#3D5EE1';
const copy = messages.email.newDevice;

export interface NewDeviceInput {
  schoolName: string;
  /** The device label, e.g. "Chrome on Windows". */
  device: string;
  ip?: string | null;
  at: Date;
  securityUrl: string;
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

export function newDeviceEmail(input: NewDeviceInput): Omit<EmailMessage, 'to'> {
  const rows: [string, string][] = [
    [copy.schoolLabel, input.schoolName],
    [copy.deviceLabel, input.device],
    [copy.ipLabel, input.ip || copy.unknown],
    [copy.timeLabel, fill(copy.time, { date: formatDateIN(input.at), time: timeIN(input.at) })],
  ];
  const url = escapeHtml(input.securityUrl);

  const text = [
    copy.heading,
    '',
    copy.intro,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    copy.warning,
    '',
    `${copy.button}: ${input.securityUrl}`,
  ].join('\n');

  const details = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;font-size:14px;color:#6B7280;">${escapeHtml(label)}</td><td style="padding:4px 0;font-size:14px;color:#111827;">${escapeHtml(value)}</td></tr>`,
    )
    .join('\n');

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background-color:#F4F6FB;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F6FB;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#FFFFFF;border-radius:8px;font-family:Arial,Helvetica,sans-serif;color:#1F2937;">
<tr><td style="background-color:${BRAND};padding:20px 28px;border-radius:8px 8px 0 0;color:#FFFFFF;font-size:20px;font-weight:bold;">Classloom</td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 16px 0;font-size:20px;color:#111827;">${escapeHtml(copy.heading)}</h1>
<p style="margin:0 0 16px 0;font-size:15px;line-height:22px;">${escapeHtml(copy.intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
${details}
</table>
<p style="margin:0 0 20px 0;font-size:15px;line-height:22px;">${escapeHtml(copy.warning)}</p>
<p style="margin:0;"><a href="${url}" style="display:inline-block;background-color:${BRAND};color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 24px;border-radius:6px;">${escapeHtml(copy.button)}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject: copy.subject, html, text };
}
