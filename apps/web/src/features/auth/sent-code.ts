/** Sign-in codes live 10 minutes; another may be sent 60 seconds after the last. */
const CODE_TTL_MS = 10 * 60_000;
const RESEND_AFTER_MS = 60_000;

/** An emailed sign-in code as the code step needs it (times are epoch milliseconds). */
export interface SentCode {
  email: string;
  maskedEmail: string;
  expiresAt: number;
  resendAt: number;
}

export const sentCode = (email: string, maskedEmail: string, now = Date.now()): SentCode => ({
  email,
  maskedEmail,
  expiresAt: now + CODE_TTL_MS,
  resendAt: now + RESEND_AFTER_MS,
});
