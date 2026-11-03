import {
  isValidAffiliationNumber,
  isValidPincode,
  isValidUdise,
  normalizeIndianPhone,
} from '@classloom/utils';
import { z } from 'zod';

import { yearLengthOk } from './academic-calendar';
import { emailField } from './fields';
import { BOARDS, INDIAN_STATES } from './tenancy';

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const CLASS_LEVELS = [
  'NURSERY',
  'LKG',
  'UKG',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
] as const;
export type ClassLevel = (typeof CLASS_LEVELS)[number];

export const SCHOOL_TYPES = ['CO_ED', 'BOYS', 'GIRLS'] as const;
export type SchoolType = (typeof SCHOOL_TYPES)[number];

export const RESIDENTIAL = ['DAY', 'BOARDING', 'DAY_AND_BOARDING'] as const;
export type Residential = (typeof RESIDENTIAL)[number];

export const ACADEMIC_YEAR_STATUSES = ['PLANNED', 'CURRENT', 'CLOSED'] as const;
export type AcademicYearStatus = (typeof ACADEMIC_YEAR_STATUSES)[number];

/** Offered by the form; the field itself accepts any text up to 40 characters. */
export const MEDIUM_SUGGESTIONS: readonly string[] = [
  'English',
  'Hindi',
  'Marathi',
  'Gujarati',
  'Bengali',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Odia',
  'Punjabi',
  'Urdu',
  'Assamese',
];

const stateCodeSchema = z.enum(INDIAN_STATES.map((s) => s.code));

/* ------------------------------------------------------------------ */
/* Field helpers: optional text where '' (or missing) means null       */
/* ------------------------------------------------------------------ */

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

const nullableChecked = (check: (s: string) => string | null, message: string) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((raw, ctx) => {
      if (raw == null || raw === '') return null;
      const out = check(raw);
      if (out === null) {
        ctx.addIssue({ code: 'custom', message, input: raw });
        return z.NEVER;
      }
      return out;
    });

const nullableEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.literal(''), z.enum(values)])
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

const nullableEmail = z
  .string()
  .trim()
  .nullish()
  .transform((raw, ctx) => {
    if (raw == null || raw === '') return null;
    const r = emailField.safeParse(raw);
    if (!r.success) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid email address', input: raw });
      return z.NEVER;
    }
    return r.data;
  });

const udiseField = nullableChecked(
  (s) => (isValidUdise(s) ? s : null),
  'Enter the 11-digit UDISE+ code',
);
const pinField = nullableChecked((s) => (isValidPincode(s) ? s : null), 'Enter a 6-digit PIN code');
const phoneField = nullableChecked(
  normalizeIndianPhone,
  'Enter a valid 10-digit Indian phone number',
);
const affiliationField = nullableChecked(
  (s) => (isValidAffiliationNumber(s) ? s : null),
  'Use up to 30 letters, digits, "/" or "-"',
);
const websiteField = nullableChecked(
  (s) => (s.length <= 200 && /^https:\/\/[^\s/]+\.[^\s/]+(\/\S*)?$/i.test(s) ? s : null),
  'Enter a website starting with https://',
);

/** A real calendar date as YYYY-MM-DD. */
export const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Enter a real date');

/* ------------------------------------------------------------------ */
/* School profile                                                      */
/* ------------------------------------------------------------------ */

export const schoolProfileSchema = z.object({
  name: z.string(),
  board: z.enum(BOARDS),
  code: z.string(),
  legalName: z.string().nullable(),
  shortName: z.string().nullable(),
  establishedYear: z.number().int().nullable(),
  udiseCode: z.string().nullable(),
  affiliationNumber: z.string().nullable(),
  schoolType: z.enum(SCHOOL_TYPES).nullable(),
  residential: z.enum(RESIDENTIAL).nullable(),
  medium: z.string().nullable(),
  lowestClass: z.enum(CLASS_LEVELS).nullable(),
  highestClass: z.enum(CLASS_LEVELS).nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  state: stateCodeSchema,
  pinCode: z.string().nullable(),
  logoUrl: z.string().nullable(),
});
export type SchoolProfile = z.infer<typeof schoolProfileSchema>;

export const updateSchoolProfileRequestSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    board: z.enum(BOARDS),
    legalName: nullableText(150),
    shortName: nullableText(12),
    establishedYear: z
      .number()
      .int()
      .min(1800)
      .nullish()
      .transform((v) => v ?? null),
    udiseCode: udiseField,
    affiliationNumber: affiliationField,
    schoolType: nullableEnum(SCHOOL_TYPES),
    residential: nullableEnum(RESIDENTIAL),
    medium: nullableText(40),
    lowestClass: nullableEnum(CLASS_LEVELS),
    highestClass: nullableEnum(CLASS_LEVELS),
    phone: phoneField,
    email: nullableEmail,
    website: websiteField,
    addressLine1: nullableText(120),
    addressLine2: nullableText(120),
    city: nullableText(60),
    district: nullableText(60),
    state: stateCodeSchema,
    pinCode: pinField,
  })
  .superRefine((v, ctx) => {
    if (v.establishedYear !== null && v.establishedYear > new Date().getUTCFullYear()) {
      ctx.addIssue({
        code: 'custom',
        path: ['establishedYear'],
        message: 'The year cannot be in the future',
      });
    }
    if (
      v.lowestClass !== null &&
      v.highestClass !== null &&
      CLASS_LEVELS.indexOf(v.lowestClass) > CLASS_LEVELS.indexOf(v.highestClass)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['highestClass'],
        message: 'The highest class cannot be below the lowest class',
      });
    }
  });
export type UpdateSchoolProfileRequest = z.infer<typeof updateSchoolProfileRequestSchema>;
/** What a form holds before parsing. */
export type UpdateSchoolProfileInput = z.input<typeof updateSchoolProfileRequestSchema>;

/* ------------------------------------------------------------------ */
/* Academic years                                                      */
/* ------------------------------------------------------------------ */

const termInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  startsOn: dateField,
  endsOn: dateField,
});

export const academicTermSchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  name: z.string(),
  startsOn: dateField,
  endsOn: dateField,
});
export type AcademicTerm = z.infer<typeof academicTermSchema>;

export const academicYearSchema = z.object({
  id: z.string(),
  label: z.string(),
  startsOn: dateField,
  endsOn: dateField,
  status: z.enum(ACADEMIC_YEAR_STATUSES),
  terms: z.array(academicTermSchema),
});
export type AcademicYear = z.infer<typeof academicYearSchema>;

const labelField = z.string().trim().min(1).max(20);
const termsField = z.array(termInputSchema).min(2).max(3);

const yearDatesRefine = (v: { startsOn: string; endsOn: string }, ctx: z.RefinementCtx) => {
  if (v.endsOn <= v.startsOn) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsOn'],
      message: 'The year must end after it starts',
    });
  } else if (!yearLengthOk(v.startsOn, v.endsOn)) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsOn'],
      message: 'An academic year runs between 180 and 400 days',
    });
  }
};

export const createAcademicYearRequestSchema = z
  .object({
    label: labelField.optional(),
    startsOn: dateField,
    endsOn: dateField,
    terms: termsField.optional(),
    termCount: z.union([z.literal(2), z.literal(3)]).optional(),
  })
  .superRefine((v, ctx) => {
    yearDatesRefine(v, ctx);
    if (v.terms === undefined && v.termCount === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['termCount'],
        message: 'Choose 2 or 3 terms, or send the terms',
      });
    }
  });
export type CreateAcademicYearRequest = z.infer<typeof createAcademicYearRequestSchema>;

export const updateAcademicYearRequestSchema = z
  .object({
    label: labelField.optional(),
    startsOn: dateField,
    endsOn: dateField,
    terms: termsField,
  })
  .superRefine(yearDatesRefine);
export type UpdateAcademicYearRequest = z.infer<typeof updateAcademicYearRequestSchema>;

export const academicYearsResponseSchema = z.object({ years: z.array(academicYearSchema) });
export type AcademicYearsResponse = z.infer<typeof academicYearsResponseSchema>;

/* ------------------------------------------------------------------ */
/* Campuses                                                            */
/* ------------------------------------------------------------------ */

export const campusSchema = z.object({
  id: z.string(),
  name: z.string(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  district: z.string().nullable(),
  pinCode: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  isPrimary: z.boolean(),
  isActive: z.boolean(),
});
export type Campus = z.infer<typeof campusSchema>;

export const createCampusRequestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  addressLine1: nullableText(120),
  addressLine2: nullableText(120),
  district: nullableText(60),
  pinCode: pinField,
  phone: phoneField,
  email: nullableEmail,
});
export type CreateCampusRequest = z.infer<typeof createCampusRequestSchema>;

/** A partial edit: fields left out are unchanged, '' clears one. */
export const updateCampusRequestSchema = createCampusRequestSchema.partial();
export type UpdateCampusRequest = z.infer<typeof updateCampusRequestSchema>;

export const campusesResponseSchema = z.object({ campuses: z.array(campusSchema) });
export type CampusesResponse = z.infer<typeof campusesResponseSchema>;

/* ------------------------------------------------------------------ */
/* Onboarding checklist response                                       */
/* ------------------------------------------------------------------ */

export const onboardingResponseSchema = z.object({
  visible: z.boolean(),
  items: z.array(
    z.object({
      key: z.enum(['profile', 'logo', 'academicYear', 'campuses']),
      done: z.boolean(),
    }),
  ),
  startedAt: z.iso.datetime().nullable(),
  dismissedAt: z.iso.datetime().nullable(),
});
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>;
