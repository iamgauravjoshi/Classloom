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

/** The file's sentences; the page fills them from its messages. */
export interface RecoveryCodesFileLabels {
  title: (email: string, date: string) => string;
  titleNoEmail: (date: string) => string;
  reminder: string;
}

const ENGLISH: RecoveryCodesFileLabels = {
  title: (email, date) => `Classloom recovery codes for ${email}, created ${date}`,
  titleNoEmail: (date) => `Classloom recovery codes, created ${date}`,
  reminder: 'Each code can be used once. Keep this file somewhere safe.',
};

/**
 * The text of the downloaded file: a header naming the account (when known) and the day, a
 * reminder, then one code per line.
 */
export function recoveryCodesFile(
  codes: string[],
  email: string,
  createdAt: Date,
  labels: RecoveryCodesFileLabels = ENGLISH,
): string {
  const day = isoDay(createdAt);
  return [
    email ? labels.title(email, day) : labels.titleNoEmail(day),
    labels.reminder,
    '',
    ...codes,
    '',
  ].join('\n');
}

/** Saves the codes as a text file through a temporary object URL. */
export function downloadRecoveryCodes(
  codes: string[],
  email: string,
  createdAt: Date,
  labels?: RecoveryCodesFileLabels,
): void {
  const blob = new Blob([recoveryCodesFile(codes, email, createdAt, labels)], {
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
