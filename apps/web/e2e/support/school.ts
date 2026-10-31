import { randomInt } from 'node:crypto';

import { type APIRequestContext, expect } from '@playwright/test';

import { latestEmailTo, verificationLink } from './mailpit';

/** Same value as `playwright.config.ts`: the API refuses cookie-carrying writes from elsewhere. */
export const WEB_ORIGIN = `http://localhost:${process.env.E2E_WEB_PORT || 3000}`;

/** Writes through the web app's `/api` proxy, as a browser would send them. */
const post = (request: APIRequestContext, path: string, data: unknown) =>
  request.post(`${WEB_ORIGIN}/api${path}`, { data, headers: { origin: WEB_ORIGIN } });

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const randomChars = (length: number) =>
  Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export interface VerifiedSchool {
  code: string;
  email: string;
  mobile: string;
  /** The owner's name, shown in the shell once signed in. */
  name: string;
  schoolName: string;
}

/**
 * Registers a school through the registration API (on the web origin, so through the proxy) and
 * leaves it pending: `verifyUrl` is the emailed link, for a test that opens it in the browser.
 * Every value is unique per call.
 */
export async function registerPendingSchool(
  request: APIRequestContext,
  opts: Partial<Pick<VerifiedSchool, 'name' | 'schoolName'>> = {},
): Promise<{ school: VerifiedSchool; verifyUrl: string }> {
  const suffix = randomChars(8);
  const school: VerifiedSchool = {
    // `S` + 8 characters fits ^[A-Z][A-Z0-9-]{1,10}[A-Z0-9]$.
    code: `S${suffix}`,
    email: `e2e-owner-${suffix.toLowerCase()}@example.com`,
    mobile: `9${String(randomInt(1e9)).padStart(9, '0')}`,
    name: opts.name ?? 'Asha Rawat',
    schoolName: opts.schoolName ?? 'Global International School',
  };

  const registered = await post(request, '/school-registrations', {
    schoolName: school.schoolName,
    board: 'CBSE',
    city: 'Dehradun',
    state: 'UK',
    code: school.code,
    adminName: school.name,
    email: school.email,
    mobile: school.mobile,
    acceptTerms: true,
  });
  expect(registered.status(), await registered.text()).toBe(202);

  const verifyUrl = verificationLink((await latestEmailTo(request, school.email)).text);
  return { school, verifyUrl };
}

/** Registers a school and verifies it with the token from the emailed link. */
export async function createVerifiedSchool(
  request: APIRequestContext,
  opts: Partial<Pick<VerifiedSchool, 'name' | 'schoolName'>> = {},
): Promise<VerifiedSchool> {
  const { school, verifyUrl } = await registerPendingSchool(request, opts);
  const token = new URL(verifyUrl).searchParams.get('token');
  const verified = await post(request, '/school-registrations/verify', { token });
  expect(verified.status(), await verified.text()).toBe(200);
  return school;
}

/**
 * Signs the owner in with an emailed code, through the web app's `/api` proxy. Pass the page's
 * (or context's) `request` so the session cookie lands in that browser context.
 */
export async function signInWithCode(
  request: APIRequestContext,
  school: Pick<VerifiedSchool, 'code' | 'email'>,
  remember = true,
): Promise<void> {
  const requested = await post(request, '/auth/otp/request', {
    schoolCode: school.code,
    email: school.email,
  });
  expect(requested.status(), await requested.text()).toBe(202);

  const { subject } = await latestEmailTo(request, school.email, /is your Classloom sign-in code/);
  const code = /^(\d{6}) is your Classloom sign-in code/.exec(subject)?.[1];
  expect(code, subject).toBeDefined();

  const verified = await post(request, '/auth/otp/verify', {
    schoolCode: school.code,
    email: school.email,
    code,
    remember,
  });
  expect(verified.status(), await verified.text()).toBe(200);
}
