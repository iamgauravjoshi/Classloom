/** The name the downloaded recovery codes are saved under. */
export const RECOVERY_CODES_FILENAME = 'classloom-recovery-codes.txt';

/** `YYYY-MM-DD` in India time, the app's time zone. */
const isoDay = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

/**
 * The text of the downloaded file: a header naming the account and the day, a reminder, then one
 * code per line.
 */
export function recoveryCodesFile(codes: string[], email: string, createdAt: Date): string {
  return [
    `Classloom recovery codes for ${email}, created ${isoDay(createdAt)}`,
    'Each code can be used once. Keep this file somewhere safe.',
    '',
    ...codes,
    '',
  ].join('\n');
}

/** Saves the codes as a text file through a temporary object URL. */
export function downloadRecoveryCodes(codes: string[], email: string, createdAt: Date): void {
  const blob = new Blob([recoveryCodesFile(codes, email, createdAt)], {
    type: 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = RECOVERY_CODES_FILENAME;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
