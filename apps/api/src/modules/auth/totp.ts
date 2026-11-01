import { generateSecret, generateSync } from 'otplib';

const PERIOD_SECONDS = 30;
const DIGITS = 6;

/** 20 random bytes, base32 encoded (32 characters). */
export function generateTotpSecret(): string {
  return generateSecret({ length: 20 });
}

export function otpauthUrl(email: string, secret: string): string {
  return `otpauth://totp/Classloom:${encodeURIComponent(email)}?secret=${secret}&issuer=Classloom&digits=${DIGITS}&period=${PERIOD_SECONDS}&algorithm=SHA1`;
}

/** The code for one time step. TOTP is HOTP with the counter set to the step. */
function codeForStep(secret: string, step: bigint): string {
  return generateSync({
    secret,
    strategy: 'hotp',
    counter: Number(step),
    digits: DIGITS,
    algorithm: 'sha1',
  });
}

/**
 * Returns the accepted time step (current +/- 1) for `code`, or null if no step in the window
 * matches or the step is at or before `lastStep` (replay). Blank or non-6-digit input returns null.
 */
export function matchTotpStep(
  secret: string,
  code: string,
  now: Date,
  lastStep: bigint | null,
): bigint | null {
  const cleaned = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return null;

  const current = BigInt(Math.floor(now.getTime() / 1000 / PERIOD_SECONDS));
  // Current step and one either side.
  for (const offset of [0n, -1n, 1n]) {
    const step = current + offset;
    if (lastStep !== null && step <= lastStep) continue;
    if (step < 0n) continue;
    if (codeForStep(secret, step) === cleaned) return step;
  }
  return null;
}
