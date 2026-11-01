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

const SAVED_KEY = 'classloom.sentCode';

/**
 * Remembers the code sent last for this tab (`sessionStorage`), so a reload within the 60 seconds
 * shows it instead of asking the API again. Never throws: storage can be blocked.
 */
export function saveSentCode(code: SentCode, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? window.sessionStorage).setItem(SAVED_KEY, JSON.stringify(code));
  } catch {
    // Storage blocked: a reload asks the API again, which drops a send within 60 seconds.
  }
}

/** Forgets the saved code (on sign-out, so the next person in this tab does not see it). */
export function clearSentCode(storage?: Pick<Storage, 'removeItem'>): void {
  try {
    (storage ?? window.sessionStorage).removeItem(SAVED_KEY);
  } catch {
    // Storage blocked: nothing was saved either.
  }
}

/** The code saved by `saveSentCode`, or null when none, unreadable or not shaped like one. */
export function loadSentCode(storage?: Pick<Storage, 'getItem'>): SentCode | null {
  try {
    const raw = (storage ?? window.sessionStorage).getItem(SAVED_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Record<keyof SentCode, unknown>>;
    const { schoolCode, email, maskedEmail, expiresAt, resendAt } = value;
    if (
      typeof schoolCode === 'string' &&
      typeof email === 'string' &&
      typeof maskedEmail === 'string' &&
      typeof expiresAt === 'number' &&
      typeof resendAt === 'number'
    ) {
      return { schoolCode, email, maskedEmail, expiresAt, resendAt };
    }
    return null;
  } catch {
    return null;
  }
}
