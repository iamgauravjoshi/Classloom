import { expect, type Page, type PlaywrightWorkerArgs, test } from '@playwright/test';

import { latestEmailTo, verificationLink } from './support/mailpit';
import {
  createVerifiedSchool,
  registerPendingSchool,
  signInWithCode,
  type VerifiedSchool,
} from './support/school';

// Everything here signs in, out or changes passwords, so each test owns a school and its owner and
// starts with no cookies. The shared owner session (auth.setup.ts) must stay untouched: the device
// projects run in parallel.
test.use({ storageState: { cookies: [], origins: [] } });

const CODE_SUBJECT = /is your Classloom sign-in code/;
const RESET_SUBJECT = /Reset your Classloom password/;
const SCHOOL_KEY = 'classloom.schoolCode';

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

async function newSchool(playwright: PlaywrightWorkerArgs['playwright']) {
  const request = await playwright.request.newContext();
  const school = await createVerifiedSchool(request);
  await request.dispose();
  return school;
}

/** The 6 digits from the newest sign-in code email to `email`. */
async function emailedCode(page: Page, email: string): Promise<string> {
  const { subject } = await latestEmailTo(page.request, email, CODE_SUBJECT);
  const code = /^(\d{6}) is your Classloom sign-in code/.exec(subject)?.[1];
  expect(code, subject).toBeDefined();
  return code!;
}

/** From the credentials step: asks for a code by email and types it in. */
async function signInByCode(page: Page, email: string) {
  await page.getByLabel('Email or mobile number').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  await page.getByLabel('Sign-in code').fill(await emailedCode(page, email));
}

async function signInByPassword(page: Page, identifier: string, password: string) {
  await page.getByLabel('Email or mobile number').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/en\/sign-in/);
}

async function expectDashboard(page: Page, school: VerifiedSchool) {
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  await expect(page.getByText(`Welcome back, ${school.name}`)).toBeVisible();
}

test('journey: register, code sign-in, password, mobile sign-in, reset and sign in again', async ({
  page,
  playwright,
}) => {
  test.slow();
  const request = await playwright.request.newContext();
  const { school, verifyUrl } = await registerPendingSchool(request);
  await request.dispose();

  // The verification page offers "Sign in", which opens the credentials step for that school.
  await page.goto(verifyUrl);
  await expect(page.getByText(school.code, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`/en/sign-in\\?school=${school.code}$`));
  await expect(page.getByText(/Signing in to/)).toContainText(school.schoolName);

  // A mobile number has no code to send: the button is off and the page says why.
  const emailCode = page.getByRole('button', { name: 'Email me a sign-in code' });
  await page.getByLabel('Email or mobile number').fill(school.mobile);
  await expect(emailCode).toBeDisabled();
  await expect(page.getByText(/Sign-in codes are sent by email/)).toBeVisible();

  // The email code goes to the dashboard, which names the owner and the school.
  await signInByCode(page, school.email);
  await expectDashboard(page, school);
  // Below lg the sidebar (which names the school) is a sheet behind the toggle.
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  }
  await expect(page.getByText(school.schoolName).first()).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) < 1024) await page.keyboard.press('Escape');
  // The school is remembered on this device after a successful sign-in.
  expect(await page.evaluate((key) => window.localStorage.getItem(key), SCHOOL_KEY)).toBe(
    school.code,
  );

  // Set a password from My account.
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'My account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My account' })).toBeVisible();
  const first = 'ember lantern 42 quartz';
  await page.getByLabel('New password', { exact: true }).fill(first);
  await page.getByLabel('Confirm new password').fill(first);
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByText('Your password has been set.')).toBeVisible();

  await signOut(page);

  // No `?school=`: the remembered school opens the credentials step. The mobile + password work.
  await expect(page.getByText(/Signing in to/)).toContainText(school.schoolName);
  await signInByPassword(page, school.mobile, first);
  await expectDashboard(page, school);
  await signOut(page);

  // Forgot password: the emailed link sets a new one.
  await expect(page.getByText(/Signing in to/)).toBeVisible();
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(/\/en\/forgot-password$/);
  await page.getByLabel('Email or mobile number').fill(school.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();

  const link = verificationLink(
    (await latestEmailTo(page.request, school.email, RESET_SUBJECT)).text,
  );
  await page.goto(link);
  // The token leaves the address bar once the page has hydrated; WebKit drops text typed before.
  await expect(page).toHaveURL(/\/en\/reset-password$/);
  const second = 'copper meadow 77 violin';
  await page.getByLabel('New password', { exact: true }).fill(second);
  await page.getByLabel('Confirm password').fill(second);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your password has been changed' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/sign-in/);
  // The old password is gone; the new one works.
  await signInByPassword(page, school.email, first);
  await expect(page.getByText('Email/mobile or password is incorrect.')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(second);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expectDashboard(page, school);
});

test('a protected page asks for sign-in and returns there afterwards', async ({
  page,
  playwright,
}) => {
  const school = await newSchool(playwright);

  await page.goto('/en/students');
  await expect(page).toHaveURL(/\/en\/sign-in\?next=%2Fen%2Fstudents$/);
  await page.getByLabel('School code').fill(school.code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await signInByCode(page, school.email);

  await expect(page).toHaveURL(/\/en\/students$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Students' })).toBeVisible();
});

test('a wrong password shows one message, whatever is wrong', async ({ page, playwright }) => {
  const school = await newSchool(playwright);

  await page.goto(`/en/sign-in?school=${school.code}`);
  await signInByPassword(page, school.email, 'definitely not the password');
  await expect(page.getByText('Email/mobile or password is incorrect.')).toBeVisible();
  await expect(page).toHaveURL(/\/en\/sign-in/);
});

// A service worker would hide the request from `page.route` in WebKit.
test.describe('double submit', () => {
  test.use({ serviceWorkers: 'block' });

  test('the code submits once even when Verify is pressed as it auto-submits', async ({
    page,
    playwright,
  }) => {
    const school = await newSchool(playwright);
    let verifies = 0;
    await page.route('**/api/auth/otp/verify', async (route) => {
      verifies += 1;
      // Keeps the first request in flight while the second attempt is made.
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });

    await page.goto(`/en/sign-in?school=${school.code}`);
    await page.getByLabel('Email or mobile number').fill(school.email);
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    const code = await emailedCode(page, school.email);

    await page.getByLabel('Sign-in code').fill(code);
    // The 6th digit has submitted; submit the form again straight away (as Enter or a tap would).
    await page
      .getByLabel('Sign-in code')
      .evaluate((input) => input.closest('form')!.requestSubmit());
    await expect(page).toHaveURL(/\/en\/dashboard$/);
    expect(verifies).toBe(1);
  });
});

test('signing out in one tab sends the other to sign-in on its next request', async ({
  browser,
  playwright,
}) => {
  const school = await newSchool(playwright);
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await signInWithCode(context.request, school);
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto('/en/dashboard');
    await second.goto('/en/dashboard');
    await expect(second.getByText('API online')).toBeVisible();

    await signOut(first);

    // A client-side navigation in the other tab asks the API, which no longer knows the session.
    await second.getByRole('button', { name: 'Search pages…' }).click();
    await second.getByRole('combobox').fill('Students');
    await second.keyboard.press('Enter');
    await expect(second).toHaveURL(/\/en\/sign-in/);
  } finally {
    await context.close();
  }
});

test.describe('keyboard only', () => {
  test('completes the code step without a pointer', async ({ page, playwright }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'Desktop keyboards only');
    const school = await newSchool(playwright);

    await page.goto(`/en/sign-in?school=${school.code}`);
    const identifier = page.getByLabel('Email or mobile number');
    await expect(identifier).toBeVisible();
    await identifier.focus();
    await page.keyboard.type(school.email);

    // Tab to "Email me a sign-in code" (past the password, its toggle and the checkbox).
    const emailCode = page.getByRole('button', { name: 'Email me a sign-in code' });
    for (
      let i = 0;
      i < 12 && !(await emailCode.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press('Tab');
    }
    await expect(emailCode).toBeFocused();
    await page.keyboard.press('Enter');

    // The code field has focus when the step opens: type the digits, then Enter.
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    await expect(page.getByLabel('Sign-in code')).toBeFocused();
    await page.keyboard.type(await emailedCode(page, school.email));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/en\/dashboard$/);
  });
});

test.describe('no horizontal scroll on a phone', () => {
  const noHorizontalOverflow = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  test('sign-in (every step), forgot and reset fit the screen', async ({ page, playwright }) => {
    test.skip(!isPhone(page), 'Phones only');
    const school = await newSchool(playwright);

    await page.goto('/en/sign-in');
    await expect(page.getByLabel('School code')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Enter your school code.')).toBeVisible();
    expect(await noHorizontalOverflow(page), 'school step').toBe(true);

    await page.goto(`/en/sign-in?school=${school.code}`);
    await page.getByLabel('Email or mobile number').fill(school.mobile);
    await expect(page.getByText(/Sign-in codes are sent by email/)).toBeVisible();
    expect(await noHorizontalOverflow(page), 'credentials step').toBe(true);

    await page.getByLabel('Email or mobile number').fill(school.email);
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await expect(page.getByText(/Code expires in/)).toBeVisible();
    expect(await noHorizontalOverflow(page), 'code step').toBe(true);

    await page.goto('/en/forgot-password');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await noHorizontalOverflow(page), 'forgot').toBe(true);

    await page.goto(`/en/reset-password?token=${'A'.repeat(43)}`);
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
    expect(await noHorizontalOverflow(page), 'reset').toBe(true);
  });
});
