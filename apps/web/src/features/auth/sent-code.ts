/** Sign-in codes live 10 minutes; another may be sent 60 seconds after the last. */
const CODE_TTL_MS = 10 * 60_000;
const RESEND_AFTER_MS = 60_000;

/** An emailed sign-in code as the code step needs it (times are epoch milliseconds). */
export interface SentCode {
  schoolCode: string;
  email: string;
  maskedEmail: string;
  expiresAt: number;
  resendAt: number;
}

export const sentCode = (
  schoolCode: string,
  email: string,
  maskedEmail: string,
  now = Date.now(),
): SentCode => ({
  schoolCode,
  email,
  maskedEmail,
  expiresAt: now + CODE_TTL_MS,
  resendAt: now + RESEND_AFTER_MS,
});

/**
 * The code sent last, when asking again now would be dropped by the API (same school and email,
 * within 60 seconds): showing it keeps the countdown honest instead of restarting at 10:00.
 */
export function reusableCode(
  last: SentCode | null,
  schoolCode: string,
  email: string,
  now = Date.now(),
): SentCode | null {
  if (!last || last.schoolCode !== schoolCode || last.email !== email) return null;
  return now < last.resendAt ? last : null;
}
