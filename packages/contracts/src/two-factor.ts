import { z } from 'zod';

import { sixDigitCodeField } from './auth';

/**
 * Every `AuthEventType` and `AuthMethod` value. Kept in step with the Prisma enums by
 * apps/api/src/modules/auth/auth-enums.test.ts.
 */
export const AUTH_EVENT_TYPES = [
  'SIGN_IN_SUCCEEDED',
  'SIGN_IN_FAILED',
  'SIGN_IN_PAUSED',
  'CODE_REQUESTED',
  'PASSWORD_SET',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET',
  'SIGNED_OUT',
  'TWO_FACTOR_SUCCEEDED',
  'TWO_FACTOR_FAILED',
  'RECOVERY_CODE_USED',
  'TWO_FACTOR_ENABLED',
  'TWO_FACTOR_DISABLED',
  'RECOVERY_CODES_REGENERATED',
  'DEVICE_TRUSTED',
  'DEVICE_UNTRUSTED',
  'SESSION_REVOKED',
] as const;
export const AUTH_METHODS = ['PASSWORD', 'EMAIL_CODE', 'RESET_LINK', 'RECOVERY_CODE'] as const;

/** 32 random bytes encoded as unpadded base64url (43 characters). */
const challengeField = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** A recovery code as typed. Only trimmed and capped here; the server normalises it. */
const recoveryCodeField = z
  .string()
  .max(20)
  .transform((raw) => raw.trim());

/** A blank recovery code (empty or only spaces) counts as not supplied. */
const dropBlankRecoveryCode = <T extends { recoveryCode?: string }>(value: T): T => {
  if (value.recoveryCode !== undefined && value.recoveryCode === '') {
    const { recoveryCode: _blank, ...rest } = value;
    return rest as T;
  }
  return value;
};

const exactlyOneOf = (value: { code?: string; recoveryCode?: string }) =>
  (value.code === undefined) !== (value.recoveryCode === undefined);
const oneFactorMessage = { message: 'Send either an app code or a recovery code', path: ['code'] };

/** 200 from the first sign-in step when the account has two-step sign-in on. */
export const twoFactorChallengeSchema = z.object({
  twoFactorRequired: z.literal(true),
  challenge: challengeField,
  expiresAt: z.iso.datetime(),
});
export type TwoFactorChallenge = z.infer<typeof twoFactorChallengeSchema>;

export const twoFactorVerifyRequestSchema = z
  .object({
    challenge: challengeField,
    code: sixDigitCodeField.optional(),
    recoveryCode: recoveryCodeField.optional(),
    trustDevice: z.boolean(),
  })
  .transform(dropBlankRecoveryCode)
  .refine(exactlyOneOf, oneFactorMessage);
export type TwoFactorVerifyRequest = z.infer<typeof twoFactorVerifyRequestSchema>;

export const twoFactorSetupSchema = z.object({
  secret: z.string(),
  otpauthUrl: z.string(),
});
export type TwoFactorSetup = z.infer<typeof twoFactorSetupSchema>;

export const twoFactorCodeRequestSchema = z.object({ code: sixDigitCodeField });
export type TwoFactorCodeRequest = z.infer<typeof twoFactorCodeRequestSchema>;

export const twoFactorDisableRequestSchema = z
  .object({
    code: sixDigitCodeField.optional(),
    recoveryCode: recoveryCodeField.optional(),
  })
  .transform(dropBlankRecoveryCode)
  .refine(exactlyOneOf, oneFactorMessage);
export type TwoFactorDisableRequest = z.infer<typeof twoFactorDisableRequestSchema>;

export const recoveryCodesSchema = z.object({
  recoveryCodes: z.array(z.string()).length(10),
});
export type RecoveryCodes = z.infer<typeof recoveryCodesSchema>;

export const twoFactorStatusSchema = z.object({
  enabled: z.boolean(),
  enabledAt: z.iso.datetime().nullable(),
  recoveryCodesLeft: z.number().int().min(0),
});
export type TwoFactorStatus = z.infer<typeof twoFactorStatusSchema>;

export const mySessionSchema = z.object({
  id: z.string(),
  current: z.boolean(),
  school: z.object({ code: z.string(), name: z.string() }),
  device: z.string(),
  ip: z.string().nullable(),
  signedInAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  remember: z.boolean(),
});
export type MySession = z.infer<typeof mySessionSchema>;

export const mySessionsSchema = z.object({ sessions: z.array(mySessionSchema) });
export type MySessions = z.infer<typeof mySessionsSchema>;

export const myDeviceSchema = z.object({
  id: z.string(),
  label: z.string(),
  current: z.boolean(),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  trustedUntil: z.iso.datetime().nullable(),
});
export type MyDevice = z.infer<typeof myDeviceSchema>;

export const myDevicesSchema = z.object({ devices: z.array(myDeviceSchema) });
export type MyDevices = z.infer<typeof myDevicesSchema>;

export const loginActivityEventSchema = z.object({
  id: z.string(),
  type: z.enum(AUTH_EVENT_TYPES),
  method: z.enum(AUTH_METHODS).nullable(),
  school: z.object({ code: z.string(), name: z.string() }).nullable(),
  device: z.string(),
  ip: z.string().nullable(),
  at: z.iso.datetime(),
});
export type LoginActivityEvent = z.infer<typeof loginActivityEventSchema>;

export const loginActivityPageSchema = z.object({
  events: z.array(loginActivityEventSchema),
  nextCursor: z.string().nullable(),
});
export type LoginActivityPage = z.infer<typeof loginActivityPageSchema>;
