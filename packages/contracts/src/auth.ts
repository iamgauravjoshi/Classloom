import { normaliseSchoolCode, normalizeIndianMobile, parseIdentifier } from '@classloom/utils';
import { z } from 'zod';

import { emailField } from './fields';

/** Roles a membership can hold. Only the school owner exists until Part 3 adds the rest. */
export type MembershipRoleName = 'OWNER';

/** The school code as typed: trimmed and upper-cased. Whether it exists is the server's call. */
const schoolCodeField = z
  .string()
  .transform(normaliseSchoolCode)
  .pipe(z.string().min(1, 'Enter your school code').max(12));

/** "Email or mobile number": anything `parseIdentifier` accepts, normalised (email lower-cased, mobile as E.164). */
const identifierField = z
  .string()
  // Bounds the input before any parsing; an email is at most 254 characters (RFC 5321).
  .max(254, 'Enter a valid email address or 10-digit Indian mobile number')
  .transform((raw, ctx) => {
    const id = parseIdentifier(raw);
    if (id.kind === 'invalid') {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a valid email address or 10-digit Indian mobile number',
        input: raw,
      });
      return z.NEVER;
    }
    return id.value;
  });

/** A 6-digit sign-in code; spaces (as in `482 913`) are ignored. */
const sixDigitCodeField = z
  .string()
  .transform((raw) => raw.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'));

/** 32 random bytes encoded as unpadded base64url (43 characters). */
const randomTokenField = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/**
 * The shared password rule (NIST SP 800-63B): 10 to 128 characters, anything allowed, no trimming.
 * The server adds the checks that need data (common passwords, the person's own email, school code).
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters');

export const passwordSignInRequestSchema = z.object({
  schoolCode: schoolCodeField,
  identifier: identifierField,
  // Not held to the policy: accounts must be able to sign in with whatever they already have.
  password: z.string().min(1, 'Enter your password').max(1024),
  remember: z.boolean(),
});
export type PasswordSignInRequest = z.infer<typeof passwordSignInRequestSchema>;

export const codeRequestSchema = z.object({
  schoolCode: schoolCodeField,
  email: emailField,
});
export type CodeRequest = z.infer<typeof codeRequestSchema>;

export const codeRequestAcceptedSchema = z.object({
  maskedEmail: z.string(),
});
export type CodeRequestAccepted = z.infer<typeof codeRequestAcceptedSchema>;

export const codeVerifyRequestSchema = z.object({
  schoolCode: schoolCodeField,
  email: emailField,
  code: sixDigitCodeField,
  remember: z.boolean(),
});
export type CodeVerifyRequest = z.infer<typeof codeVerifyRequestSchema>;

export const authSessionSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    mobile: z.string().nullable(),
    hasPassword: z.boolean(),
  }),
  school: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  campus: z.object({ id: z.string(), name: z.string() }),
  role: z.literal('OWNER'),
  remember: z.boolean(),
  expiresAt: z.iso.datetime(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const forgotPasswordRequestSchema = z.object({
  identifier: identifierField,
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: randomTokenField,
  newPassword: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const meSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  mobile: z.string().nullable(),
  hasPassword: z.boolean(),
});
export type Me = z.infer<typeof meSchema>;

/** Profile edits. `mobile: null` (or a blank string) clears the number; leaving it out keeps it. */
export const updateMeRequestSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  mobile: z
    .string()
    .nullable()
    .transform((raw, ctx) => {
      if (raw === null || raw.trim() === '') return null;
      const e164 = normalizeIndianMobile(raw.trim());
      if (e164 === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'Enter a valid 10-digit Indian mobile number',
          input: raw,
        });
        return z.NEVER;
      }
      return e164;
    })
    .optional(),
});
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;

/** `currentPassword` is required by the server when the user already has a password. */
export const setPasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(1024).optional(),
  newPassword: passwordSchema,
});
export type SetPasswordRequest = z.infer<typeof setPasswordRequestSchema>;
