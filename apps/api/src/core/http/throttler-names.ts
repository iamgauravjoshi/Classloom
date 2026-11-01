/** Named throttlers; every guarded route skips the ones that are not its own. */
export const REGISTRATION_THROTTLER = 'registration';
export const AVAILABILITY_THROTTLER = 'availability';
/** Per-address limit on resend (and cancel), on top of resend's per email+code limit. */
export const RESEND_THROTTLER = 'resend';
/** Shared by password sign-in and code verification. */
export const SIGN_IN_THROTTLER = 'sign-in';
export const CODE_REQUEST_THROTTLER = 'code-request';
export const PASSWORD_RESET_THROTTLER = 'password-reset';

/** For `@SkipThrottle`: every named throttler except `own`. */
export function skipAllBut(own: string): Record<string, boolean> {
  return Object.fromEntries(
    [
      REGISTRATION_THROTTLER,
      AVAILABILITY_THROTTLER,
      RESEND_THROTTLER,
      SIGN_IN_THROTTLER,
      CODE_REQUEST_THROTTLER,
      PASSWORD_RESET_THROTTLER,
    ]
      .filter((name) => name !== own)
      .map((name) => [name, true]),
  );
}
