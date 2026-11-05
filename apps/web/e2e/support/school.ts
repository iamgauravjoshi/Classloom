import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { generateSync } from 'otplib';

import { latestEmailTo, mailIds, verificationLink } from './mailpit';

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
  opts: Partial<Pick<VerifiedSchool, 'name' | 'schoolName' | 'email'>> = {},
): Promise<{ school: VerifiedSchool; verifyUrl: string }> {
  const suffix = randomChars(8);
  const school: VerifiedSchool = {
    // `S` + 8 characters fits ^[A-Z][A-Z0-9-]{1,10}[A-Z0-9]$.
    code: `S${suffix}`,
    // Reusing an email gives one person (users are global) an account at several schools.
    email: opts.email ?? `e2e-owner-${suffix.toLowerCase()}@example.com`,
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

  const verifyUrl = verificationLink(
    (await latestEmailTo(request, school.email, undefined, new RegExp(school.code))).text,
  );
  return { school, verifyUrl };
}

/** Registers a school and verifies it with the token from the emailed link. */
export async function createVerifiedSchool(
  request: APIRequestContext,
  opts: Partial<Pick<VerifiedSchool, 'name' | 'schoolName' | 'email'>> = {},
): Promise<VerifiedSchool> {
  const { school, verifyUrl } = await registerPendingSchool(request, opts);
  const token = new URL(verifyUrl).searchParams.get('token');
  const verified = await post(request, '/school-registrations/verify', { token });
  expect(verified.status(), await verified.text()).toBe(200);
  return school;
}

/**
 * Signs the owner in with an emailed code, through the web app's `/api` proxy, and lets the owner
 * use the whole app (see `relaxOwnerTwoFactor`). Pass the page's (or context's) `request` so the
 * session cookie lands in that browser context.
 */
export async function signInWithCode(
  request: APIRequestContext,
  school: Pick<VerifiedSchool, 'code' | 'email'>,
  remember = true,
): Promise<void> {
  await signInWithCodeKeepingRequirement(request, school, remember);
  // Owner requires two-step by default, which would limit the session to the setup routes.
  await relaxOwnerTwoFactor(request);
  // The dashboard would otherwise open the setup wizard on the first visit.
  await markSetupWizardSeen(request);
}

/**
 * Records that the school's setup wizard was opened (`POST /school/onboarding/start`), as opening
 * it does, so the dashboard no longer sends the owner there. `signInWithCode` calls it; a test of
 * the first-run redirect signs in with `signInWithCodeKeepingRequirement` and
 * `relaxOwnerTwoFactor` instead.
 */
export async function markSetupWizardSeen(request: APIRequestContext): Promise<void> {
  const started = await post(request, '/school/onboarding/start', {});
  expect(started.status(), await started.text()).toBe(204);
}

/**
 * The same sign-in, but the owner keeps the Owner role's two-step requirement: the session is
 * limited to the setup routes, as a real new school's owner is. For reaching the setup page.
 */
export async function signInWithCodeKeepingRequirement(
  request: APIRequestContext,
  school: Pick<VerifiedSchool, 'code' | 'email'>,
  remember = true,
): Promise<void> {
  // An address can hold codes from other schools or earlier sign-ins: only a new one is ours.
  const before = await mailIds(request, school.email);
  const requested = await post(request, '/auth/otp/request', {
    schoolCode: school.code,
    email: school.email,
  });
  expect(requested.status(), await requested.text()).toBe(202);

  const { subject } = await latestEmailTo(
    request,
    school.email,
    /is your Classloom sign-in code/,
    undefined,
    before,
  );
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

/** The app code for a base32 secret, `offsetMs` from now. */
const codeFor = (secret: string, offsetMs = 0) =>
  generateSync({ secret, epoch: Math.floor((Date.now() + offsetMs) / 1000) });

/**
 * Lets the signed-in owner use the whole app without two-step sign-in. Owner requires it by
 * default, which limits a session without it to the setup routes, and only a session outside that
 * limit can change a role. So it turns two-step on, switches the requirement off on the Owner role,
 * then turns two-step off again: the owner ends as it was, and a later sign-in needs no second
 * step. `signInWithCode` calls it, so a test's owner is not limited to the setup routes.
 */
export async function relaxOwnerTwoFactor(request: APIRequestContext): Promise<void> {
  const setup = await post(request, '/me/two-factor/setup', {});
  expect(setup.status(), await setup.text()).toBe(200);
  const { secret } = (await setup.json()) as { secret: string };
  const enabled = await post(request, '/me/two-factor/enable', { code: codeFor(secret) });
  expect(enabled.status(), await enabled.text()).toBe(200);

  const roles = await request.get(`${WEB_ORIGIN}/api/iam/roles`);
  expect(roles.status(), await roles.text()).toBe(200);
  const ownerRole = (
    (await roles.json()) as { roles: { id: string; key: string | null }[] }
  ).roles.find((role) => role.key === 'OWNER');
  expect(ownerRole).toBeDefined();
  const updated = await request.put(`${WEB_ORIGIN}/api/iam/roles/${ownerRole?.id}`, {
    data: { requiresTwoFactor: false },
    headers: { origin: WEB_ORIGIN },
  });
  expect(updated.status(), await updated.text()).toBe(200);

  // A code for the next 30-second step: the one just used cannot be used twice.
  const disabled = await post(request, '/me/two-factor/disable', {
    code: codeFor(secret, 30_000),
  });
  expect(disabled.status(), await disabled.text()).toBe(204);
}

/** An academic year's dates (YYYY-MM-DD) and its default label (`2026–27`, with an en dash). */
export interface YearDates {
  label: string;
  startsOn: string;
  endsOn: string;
}

/** The April-to-March academic year today (in IST) falls in, as the year form pre-fills it. */
export function currentAcademicYear(): YearDates {
  const [y, m] = new Date(Date.now() + 330 * 60_000)
    .toISOString()
    .slice(0, 7)
    .split('-')
    .map(Number);
  const start = m! >= 4 ? y! : y! - 1;
  return {
    label: `${start}–${String(start + 1).slice(2)}`,
    startsOn: `${start}-04-01`,
    endsOn: `${start + 1}-03-31`,
  };
}

/**
 * Creates the school's current academic year (today's April-to-March year, with the default terms)
 * through the API, from a request context signed in as someone who manages settings.
 */
export async function setUpCurrentYear(
  request: APIRequestContext,
  termCount: 2 | 3 = 2,
): Promise<YearDates & { id: string }> {
  const year = currentAcademicYear();
  const created = await post(request, '/school/academic-years', {
    startsOn: year.startsOn,
    endsOn: year.endsOn,
    termCount,
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  return { ...year, id };
}

/** The school's primary campus's id, from a signed-in request context. */
export async function primaryCampusId(request: APIRequestContext): Promise<string> {
  const listed = await request.get(`${WEB_ORIGIN}/api/school/campuses`);
  expect(listed.status(), await listed.text()).toBe(200);
  const { campuses } = (await listed.json()) as { campuses: { id: string; isPrimary: boolean }[] };
  const primary = campuses.find((campus) => campus.isPrimary);
  expect(primary, 'primary campus').toBeDefined();
  return primary!.id;
}

/**
 * Sets the school profile's class range (`NURSERY`…`XII`), keeping the rest of the profile, from a
 * request context that manages settings.
 */
export async function setClassRange(
  request: APIRequestContext,
  lowestClass: string,
  highestClass: string,
): Promise<void> {
  const read = await request.get(`${WEB_ORIGIN}/api/school/profile`);
  expect(read.status(), await read.text()).toBe(200);
  const {
    code: _code,
    logoUrl: _logo,
    ...profile
  } = (await read.json()) as Record<string, unknown>;
  const saved = await request.put(`${WEB_ORIGIN}/api/school/profile`, {
    data: { ...profile, lowestClass, highestClass },
    headers: { origin: WEB_ORIGIN },
  });
  expect(saved.status(), await saved.text()).toBe(200);
}

/**
 * Adds the starter streams (Science, Commerce and Humanities) from a request context that manages
 * classes, and returns their ids by name.
 */
export async function setUpStreams(request: APIRequestContext): Promise<Record<string, string>> {
  const added = await post(request, '/academics/streams/starter', {});
  expect(added.status(), await added.text()).toBe(201);
  const { created } = (await added.json()) as { created: { id: string; name: string }[] };
  return Object.fromEntries(created.map((stream) => [stream.name, stream.id]));
}

/** Adds a classroom (on the primary campus unless `campusId` is given) and returns its id. */
export async function addRoom(
  request: APIRequestContext,
  room: { name: string; capacity?: number; type?: string; campusId?: string },
): Promise<string> {
  const created = await post(request, '/academics/rooms', {
    type: 'CLASSROOM',
    capacity: 40,
    ...room,
    campusId: room.campusId ?? (await primaryCampusId(request)),
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

/**
 * Adds a section to a year (on the primary campus unless `campusId` is given) and returns its id.
 * The class must be in the profile's class range, and a senior class needs a stream while the
 * school has any.
 */
export async function addSection(
  request: APIRequestContext,
  section: {
    academicYearId: string;
    classLevel: string;
    name: string;
    capacity?: number;
    streamId?: string | null;
    roomId?: string | null;
    classTeacherMembershipId?: string | null;
    campusId?: string;
  },
): Promise<string> {
  const created = await post(request, '/academics/sections', {
    capacity: 40,
    ...section,
    campusId: section.campusId ?? (await primaryCampusId(request)),
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

/** A small JPEG photo (1024x768), shared with the API's image-intake tests. */
export const LOGO_JPEG = {
  name: 'logo.jpg',
  mimeType: 'image/jpeg',
  buffer: readFileSync(
    fileURLToPath(
      new URL('../../../api/test/fixtures/images/landscape-1024x768.jpg', import.meta.url),
    ),
  ),
};

/** Uploads `LOGO_JPEG` as the school's logo, from a request context that manages settings. */
export async function uploadLogo(request: APIRequestContext): Promise<void> {
  const uploaded = await request.put(`${WEB_ORIGIN}/api/school/logo`, {
    multipart: { file: LOGO_JPEG },
    headers: { origin: WEB_ORIGIN },
  });
  expect(uploaded.status(), await uploaded.text()).toBe(200);
}

/**
 * Closes every toast on the page. A toast sits over the bottom of the screen, where the next
 * button often is, and hovering it (as a click on what lies beneath does) pauses its timer, so it
 * would never leave. Hovering the stack spreads it out, so each close button can be clicked in
 * turn. Call it once the change that announced the toast is visible: the toast comes with it.
 */
export async function closeToasts(page: Page): Promise<void> {
  // A closed toast stays in the page while it slides out; it is no longer in the way.
  const open = page.locator('[data-slot="toast"]:not([data-ending-style])');
  await expect(async () => {
    const close = open.getByRole('button', { name: 'Close toast' });
    // One may leave by itself between the count and the click: the next pass finds the rest.
    if ((await close.count()) > 0) await close.first().click({ timeout: 2_000 });
    expect(await open.count()).toBe(0);
  }).toPass({ timeout: 10_000 });
}
