import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PasswordIssue =
  'too_short' | 'too_long' | 'common' | 'contains_email' | 'contains_school_code';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
const EMAIL_LOCAL_MIN_LENGTH = 4;

let commonPasswords: Set<string> | undefined;

/** Loaded once, lazily. Resolved relative to this file so it works from `src` (vitest) and `dist`. */
function loadCommonPasswords(): Set<string> {
  if (!commonPasswords) {
    const raw = readFileSync(join(__dirname, 'common-passwords.txt'), 'utf8');
    commonPasswords = new Set(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter((line) => line !== '' && !line.startsWith('#')),
    );
  }
  return commonPasswords;
}

function isCommon(lower: string): boolean {
  const list = loadCommonPasswords();
  if (list.has(lower)) return true;
  // Also reject a common word with only digits appended ("password1234").
  const base = lower.replace(/\d+$/, '');
  return base.length > 0 && list.has(base);
}

/**
 * Server-side checks on top of the shared length rules. Over-long input returns `too_long`
 * immediately, before any scanning, so huge strings cannot cause expensive work.
 */
export function checkPasswordPolicy(
  password: string,
  ctx: { email: string; schoolCodes: string[] },
): PasswordIssue[] {
  if (password.length > PASSWORD_MAX_LENGTH) return ['too_long'];
  const issues: PasswordIssue[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) issues.push('too_short');

  const lower = password.toLowerCase();
  if (isCommon(lower)) issues.push('common');

  const local = ctx.email.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= EMAIL_LOCAL_MIN_LENGTH && lower.includes(local))
    issues.push('contains_email');

  if (ctx.schoolCodes.some((code) => code !== '' && lower.includes(code.toLowerCase()))) {
    issues.push('contains_school_code');
  }
  return issues;
}
