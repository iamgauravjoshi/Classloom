import type { PasswordRule } from '@classloom/ui/components/password-rules';

/** Same limits as `passwordSchema` in `@classloom/contracts` (counted the same way). */
const MIN_LENGTH = 10;
const MAX_LENGTH = 128;

/**
 * The password rules the browser can check as you type. The server adds the ones that need data
 * (common passwords, your email, your school code) and reports them after submit.
 */
export function passwordRuleList(password: string, t: (key: 'length') => string): PasswordRule[] {
  return [
    { label: t('length'), met: password.length >= MIN_LENGTH && password.length <= MAX_LENGTH },
  ];
}
