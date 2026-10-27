import { normalizeIndianMobile, parseIdentifier, validateSchoolCode } from '@classloom/utils';
import { z } from 'zod';

export const BOARDS = ['CBSE', 'ICSE', 'STATE', 'IB', 'CAMBRIDGE', 'OTHER'] as const;
export type Board = (typeof BOARDS)[number];

/** 28 states and 8 union territories. Codes are the ISO 3166-2:IN suffixes. */
export const INDIAN_STATES = [
  { code: 'AN', name: 'Andaman and Nicobar Islands' },
  { code: 'AP', name: 'Andhra Pradesh' },
  { code: 'AR', name: 'Arunachal Pradesh' },
  { code: 'AS', name: 'Assam' },
  { code: 'BR', name: 'Bihar' },
  { code: 'CG', name: 'Chhattisgarh' },
  { code: 'CH', name: 'Chandigarh' },
  { code: 'DH', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: 'DL', name: 'Delhi' },
  { code: 'GA', name: 'Goa' },
  { code: 'GJ', name: 'Gujarat' },
  { code: 'HP', name: 'Himachal Pradesh' },
  { code: 'HR', name: 'Haryana' },
  { code: 'JH', name: 'Jharkhand' },
  { code: 'JK', name: 'Jammu and Kashmir' },
  { code: 'KA', name: 'Karnataka' },
  { code: 'KL', name: 'Kerala' },
  { code: 'LA', name: 'Ladakh' },
  { code: 'LD', name: 'Lakshadweep' },
  { code: 'MH', name: 'Maharashtra' },
  { code: 'ML', name: 'Meghalaya' },
  { code: 'MN', name: 'Manipur' },
  { code: 'MP', name: 'Madhya Pradesh' },
  { code: 'MZ', name: 'Mizoram' },
  { code: 'NL', name: 'Nagaland' },
  { code: 'OD', name: 'Odisha' },
  { code: 'PB', name: 'Punjab' },
  { code: 'PY', name: 'Puducherry' },
  { code: 'RJ', name: 'Rajasthan' },
  { code: 'SK', name: 'Sikkim' },
  { code: 'TN', name: 'Tamil Nadu' },
  { code: 'TR', name: 'Tripura' },
  { code: 'TG', name: 'Telangana' },
  { code: 'UK', name: 'Uttarakhand' },
  { code: 'UP', name: 'Uttar Pradesh' },
  { code: 'WB', name: 'West Bengal' },
] as const;
export type IndianStateCode = (typeof INDIAN_STATES)[number]['code'];

const stateCodeSchema = z.enum(INDIAN_STATES.map((s) => s.code));

const schoolCodeField = z.string().transform((raw, ctx) => {
  const check = validateSchoolCode(raw);
  if (!check.ok) {
    ctx.addIssue({
      code: 'custom',
      message:
        check.problem === 'reserved'
          ? 'This school code is reserved'
          : 'Use 3–12 letters or digits, with single hyphens between parts',
      input: raw,
    });
    return z.NEVER;
  }
  return check.code;
});

const emailField = z.string().transform((raw, ctx) => {
  const id = parseIdentifier(raw);
  if (id.kind !== 'email') {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid email address', input: raw });
    return z.NEVER;
  }
  return id.value;
});

const optionalMobileField = z
  .string()
  .transform((raw, ctx) => {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    const e164 = normalizeIndianMobile(trimmed);
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
  .optional();

/** Public request to register a school. Output values are normalised. */
export const schoolRegistrationRequestSchema = z.object({
  schoolName: z.string().trim().min(3).max(120),
  board: z.enum(BOARDS),
  city: z.string().trim().min(2).max(60),
  state: stateCodeSchema,
  code: schoolCodeField,
  adminName: z.string().trim().min(2).max(80),
  email: emailField,
  mobile: optionalMobileField,
  acceptTerms: z.literal(true),
});
export type SchoolRegistrationRequest = z.infer<typeof schoolRegistrationRequestSchema>;

export const codeAvailabilityQuerySchema = z.object({
  code: z.string().optional(),
  name: z.string().optional(),
  city: z.string().optional(),
});
export type CodeAvailabilityQuery = z.infer<typeof codeAvailabilityQuerySchema>;

export const codeAvailabilityResponseSchema = z.object({
  code: z.string(),
  available: z.boolean(),
  reason: z.enum(['taken', 'reserved', 'invalid']).optional(),
  suggestion: z.string().optional(),
});
export type CodeAvailabilityResponse = z.infer<typeof codeAvailabilityResponseSchema>;

/** 32 random bytes encoded as unpadded base64url (43 characters). */
const randomTokenField = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const schoolRegistrationAcceptedSchema = z.object({
  maskedEmail: z.string(),
  /**
   * Lets this browser withdraw the registration ("Use a different email") while it is still
   * pending. Keep it in memory only; never store it.
   */
  cancelToken: randomTokenField,
});
export type SchoolRegistrationAccepted = z.infer<typeof schoolRegistrationAcceptedSchema>;

export const resendRegistrationRequestSchema = z.object({
  email: emailField,
  code: schoolCodeField,
});
export type ResendRegistrationRequest = z.infer<typeof resendRegistrationRequestSchema>;

/** Withdraws a pending registration; always 204, so it reveals nothing about the token. */
export const cancelRegistrationRequestSchema = z.object({
  cancelToken: randomTokenField,
});
export type CancelRegistrationRequest = z.infer<typeof cancelRegistrationRequestSchema>;

/** Verification token from the emailed link. */
export const verifyRegistrationRequestSchema = z.object({
  token: randomTokenField,
});
export type VerifyRegistrationRequest = z.infer<typeof verifyRegistrationRequestSchema>;

export const verifyRegistrationResponseSchema = z.object({
  code: z.string(),
  name: z.string(),
});
export type VerifyRegistrationResponse = z.infer<typeof verifyRegistrationResponseSchema>;

export const publicSchoolSchema = z.object({
  code: z.string(),
  name: z.string(),
  city: z.string(),
  state: stateCodeSchema,
});
export type PublicSchool = z.infer<typeof publicSchoolSchema>;
