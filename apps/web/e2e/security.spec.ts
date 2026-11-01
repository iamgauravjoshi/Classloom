import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs,
  test,
} from '@playwright/test';

import { latestEmailTo, mailIds } from './support/mailpit';
import { createVerifiedSchool, signInWithCode, WEB_ORIGIN } from './support/school';
import { enableTwoFactorFor, totpCode } from './support/totp';

// Everything here signs in and out, ends sessions or changes two-step settings, so each test owns a
// school and its owner and starts with no cookies. The shared owner session (auth.setup.ts) must
// stay untouched: the device projects run in parallel.
test.use({ storageState: { cookies: [], origins: [] } });

const PASSWORD = 'ember lantern 42 quartz';
const NEW_PASSWORD = 'copper meadow 77 violin';
const CODE_SUBJECT = /is your Classloom sign-in code/;
const SECURITY_PATH = '/en/account/security';

type School = Awaited<ReturnType<typeof createVerifiedSchool>>;

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;
const visible = (locator: Locator) => locator.filter({ visible: true });
const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Writes through the web app's `/api` proxy, as a browser would send them. */
const post = (request: APIRequestContext, path: string, data?: unknown) =>
  request.post(`${WEB_ORIGIN}/api${path}`, { data, headers: { origin: WEB_ORIGIN } });

async function newSchool(
  playwright: PlaywrightWorkerArgs['playwright'],
  opts: Parameters<typeof createVerifiedSchool>[1] = {},
) {
  const request = await playwright.request.newContext();
  const school = await createVerifiedSchool(request, opts);
  await request.dispose();
  return school;
}

/** Signs in with a password through the API; the session cookie lands in `request`. */
async function apiSignIn(request: APIRequestContext, school: School, password = PASSWORD) {
  const res = await post(request, '/auth/sign-in/password', {
    schoolCode: school.code,
    identifier: school.email,
    password,
    remember: true,
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Signs in with an emailed code and sets a password, so more sessions can follow without email. */
async function signInAndSetPassword(request: APIRequestContext, school: School) {
  await signInWithCode(request, school);
  const set = await request.put(`${WEB_ORIGIN}/api/me/password`, {
    data: { newPassword: PASSWORD },
    headers: { origin: WEB_ORIGIN },
  });
  expect(set.status(), await set.text()).toBe(204);
}

async function signInByPassword(page: Page, school: School, password: string) {
  await page.goto(`/en/sign-in?school=${school.code}`);
  await page.getByLabel('Email or mobile number').fill(school.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/**
 * Opens the account menu and signs out. Retried as a whole: a refetch right after a save can
 * re-render the menu and swallow the first click.
 */
async function signOut(page: Page) {
  await expect(async () => {
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click({ timeout: 2_000 });
    await expect(page).toHaveURL(/\/en\/sign-in/, { timeout: 3_000 });
  }).toPass({ timeout: 15_000 });
}

const twoStepHeading = (page: Page) =>
  page.getByRole('heading', { level: 1, name: 'Two-step sign-in' });
const trustBox = (page: Page) =>
  page.getByRole('checkbox', { name: /Don't ask again on this device/ });

/** The code a sign-in email to `email` holds, ignoring mail that was already there. */
async function newEmailedCode(page: Page, email: string, before: ReadonlySet<string>) {
  const { subject } = await latestEmailTo(page.request, email, CODE_SUBJECT, undefined, before);
  const code = /^(\d{6}) is your Classloom sign-in code/.exec(subject)?.[1];
  expect(code, subject).toBeDefined();
  return code!;
}

/** A TOTP code for the step after the current one: the enabling code used the current step. */
const nextCode = (secret: string) => totpCode(secret, new Date(Date.now() + 30_000));

/** Opens Turn on, reads the shown key, and returns the dialog and the key (no spaces). */
async function openSetup(page: Page) {
  await page.getByRole('button', { name: 'Turn on' }).click();
  const dialog = page.locator('[data-slot="dialog-content"]');
  const shown = await dialog.getByText(/^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/).innerText();
  return { dialog, secret: shown.replace(/\s/g, '') };
}

async function recoveryCodesIn(dialog: Locator): Promise<string[]> {
  const codes = await dialog
    .getByRole('list', { name: 'Recovery codes' })
    .getByRole('listitem')
    .allInnerTexts();
  expect(codes).toHaveLength(10);
  return codes;
}

/** Tabs until `target` has focus (at most `max` presses). */
async function tabTo(page: Page, target: Locator, max = 20) {
  for (let i = 0; i < max && !(await target.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

test('journey: turn on, app code, trust the device, password change, recovery code, turn off', async ({
  page,
  playwright,
}) => {
  test.slow();
  const school = await newSchool(playwright);
  // A fresh sign-in (turning on needs one from the last 10 minutes) and a password to sign in with.
  await signInAndSetPassword(page.request, school);

  await page.goto(SECURITY_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'My account' })).toBeVisible();
  const { dialog, secret } = await openSetup(page);
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByLabel('Authenticator code').fill(totpCode(secret));
  await expect(dialog.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const recoveryCodes = await recoveryCodesIn(dialog);

  // Done stays off until the codes are marked as saved.
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: "I've saved these codes" }).check();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  const twoFactor = page.getByRole('region', { name: 'Two-step sign-in' });
  await expect(twoFactor.getByText('On', { exact: true })).toBeVisible();
  await expect(twoFactor.getByText('10 recovery codes left')).toBeVisible();

  // Signed out, the password leads to the two-step step; "don't ask again" is a choice, not a default.
  await signOut(page);
  await signInByPassword(page, school, PASSWORD);
  await expect(twoStepHeading(page)).toBeVisible();
  await expect(trustBox(page)).not.toBeChecked();
  await trustBox(page).check();
  await page.getByLabel('Authenticator code').fill(nextCode(secret));
  await expect(page).toHaveURL(/\/en\/dashboard$/);

  // The trusted device skips the step.
  await signOut(page);
  await signInByPassword(page, school, PASSWORD);
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  await page.goto(SECURITY_PATH);
  const devices = page.getByRole('region', { name: 'Trusted devices' });
  await expect(devices.getByText('This device')).toBeVisible();

  // Changing the password clears the trust: the step is back.
  await page.goto('/en/account');
  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText(/Your password has been changed/)).toBeVisible();
  await signOut(page);
  await signInByPassword(page, school, NEW_PASSWORD);
  await expect(twoStepHeading(page)).toBeVisible();

  // A recovery code finishes it.
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await page.getByLabel('Recovery code').fill(recoveryCodes[0]!);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/en\/dashboard$/);

  // The history reads back what happened.
  await page.goto(SECURITY_PATH);
  const activity = page.getByRole('region', { name: 'Sign-in history' });
  for (const label of [
    'Recovery code used',
    'Two-step code accepted',
    'Two-step sign-in turned on',
  ]) {
    await expect(visible(activity.getByText(label, { exact: true })).first()).toBeVisible();
  }
  await expect(
    page.getByRole('region', { name: 'Two-step sign-in' }).getByText('9 recovery codes left'),
  ).toBeVisible();

  // Turn off with another recovery code.
  await page.getByRole('button', { name: 'Turn off' }).click();
  const off = page.getByRole('dialog', { name: 'Turn off two-step sign-in' });
  await off.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await off.getByLabel('Recovery code').fill(recoveryCodes[1]!);
  await off.getByRole('button', { name: 'Turn off' }).click();
  await expect(off).toBeHidden();
  await expect(twoFactor.getByText('Off', { exact: true })).toBeVisible();
  await expect(twoFactor.getByRole('button', { name: 'Turn on' })).toBeVisible();
  await expect(
    visible(activity.getByText('Two-step sign-in turned off', { exact: true })).first(),
  ).toBeVisible();
});

test('the two-step step also follows an emailed code, with "Don\'t ask again" unticked', async ({
  page,
  playwright,
}) => {
  // The same person at two schools: a code is asked for once a minute per school, so the first
  // school's sign-in (to turn two-step on) leaves the second school's code free to be asked for.
  const request = await playwright.request.newContext();
  const first = await createVerifiedSchool(request);
  const second = await createVerifiedSchool(request, { email: first.email });
  const { secret } = await enableTwoFactorFor(request, first);
  await request.dispose();

  await page.goto(`/en/sign-in?school=${second.code}`);
  const before = await mailIds(page.request, second.email);
  await page.getByLabel('Email or mobile number').fill(second.email);
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  await page.getByLabel('Sign-in code').fill(await newEmailedCode(page, second.email, before));

  await expect(twoStepHeading(page)).toBeVisible();
  await expect(trustBox(page)).not.toBeChecked();
  await page.getByLabel('Authenticator code').fill(nextCode(secret));
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  await expect(page.getByText(`Welcome back, ${second.name}`)).toBeVisible();
});

test.describe('an expired challenge', () => {
  test('leaves only "Start again" once the countdown runs out', async ({ page, playwright }) => {
    const school = await newSchool(playwright);
    const request = await playwright.request.newContext();
    await enableTwoFactorFor(request, school, PASSWORD);
    await request.dispose();

    // The page's clock runs on, but is ours to move: the challenge lasts 5 minutes.
    await page.clock.install();
    await signInByPassword(page, school, PASSWORD);
    await expect(twoStepHeading(page)).toBeVisible();
    await expect(page.getByText(/Sign-in expires in 0[0-5]:\d\d/)).toBeVisible();

    await page.clock.fastForward('06:00');
    await expect(page.getByText('This sign-in has expired. Start again.')).toBeVisible();
    await expect(page.getByLabel('Authenticator code')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Verify' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Use a recovery code instead' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Start again' }).click();
    await expect(page.getByLabel('Email or mobile number')).toBeVisible();
  });
});

// A service worker would hide the request from `page.route` in WebKit.
test.describe('a sign-in that is too old', () => {
  test.use({ serviceWorkers: 'block' });

  // The API decides "too old" from a server-side timestamp (`authenticated_at`) that the browser's
  // clock cannot move, and there is no test-only route to move it. So the 403 is answered here by
  // the test, and everything after it is real: the redirect to the email-code step, the code, and
  // the way back to the Security page (the API side of the 10-minute rule has its own
  // integration tests).
  test('Turn on sends the person through re-sign-in and back to Security', async ({
    page,
    playwright,
  }) => {
    // One person at two schools: the session is at the second (by password, so no code was asked
    // for there) and the re-sign-in code the page asks for is the first for that school.
    const request = await playwright.request.newContext();
    const first = await createVerifiedSchool(request);
    const second = await createVerifiedSchool(request, { email: first.email });
    await signInAndSetPassword(request, first);
    await request.dispose();
    await apiSignIn(page.request, second);

    await page.route('**/api/me/two-factor/setup', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://classloom.app/problems/recent-sign-in-required',
          title: 'Forbidden',
          status: 403,
        }),
      }),
    );
    await page.goto(SECURITY_PATH);
    await expect(page.getByRole('button', { name: 'Turn on' })).toBeVisible();
    const before = await mailIds(page.request, second.email);
    await page.getByRole('button', { name: 'Turn on' }).click();

    await expect(page).toHaveURL(
      new RegExp(`/en/sign-in\\?school=${second.code}&next=%2Fen%2Faccount%2Fsecurity&reauth=1$`),
    );
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    await page.unroute('**/api/me/two-factor/setup');
    await page.getByLabel('Sign-in code').fill(await newEmailedCode(page, second.email, before));

    await expect(page).toHaveURL(/\/en\/account\/security$/);
    // The setup now goes through.
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(
      page
        .getByRole('dialog', { name: 'Turn on two-step sign-in' })
        .getByRole('img', { name: /QR code/ }),
    ).toBeVisible();
  });
});

test.describe('sessions', () => {
  /** A school with the browser signed in, and `count` more sessions in contexts of their own. */
  async function withOtherSessions(
    page: Page,
    playwright: PlaywrightWorkerArgs['playwright'],
    count: number,
  ) {
    const school = await newSchool(playwright);
    await signInAndSetPassword(page.request, school);
    const others: APIRequestContext[] = [];
    for (let i = 0; i < count; i++) {
      const other = await playwright.request.newContext();
      await apiSignIn(other, school);
      others.push(other);
    }
    return { school, others };
  }

  const isLive = async (request: APIRequestContext) =>
    (await request.get(`${WEB_ORIGIN}/api/auth/session`)).status() === 200;

  test('End ends one session and refreshes the list', async ({ page, playwright }) => {
    const { others } = await withOtherSessions(page, playwright, 2);
    await page.goto(SECURITY_PATH);
    const sessions = page.getByRole('region', { name: 'Active sessions' });
    const endButtons = sessions.getByRole('button', { name: /^End session:/ });
    await expect(sessions.getByText('This device')).toBeVisible();
    await expect(endButtons).toHaveCount(2);

    await endButtons.first().click();
    await expect(page.getByText('The session has ended.')).toBeVisible();
    await expect(endButtons).toHaveCount(1);
    const live = await Promise.all(others.map(isLive));
    expect(live.filter(Boolean)).toHaveLength(1);

    // The history picks up the end of the session.
    const activity = page.getByRole('region', { name: 'Sign-in history' });
    await expect(
      visible(activity.getByText('Session ended', { exact: true })).first(),
    ).toBeVisible();
    await Promise.all(others.map((other) => other.dispose()));
  });

  test('End all other sessions ends the rest and keeps this one', async ({ page, playwright }) => {
    const { others } = await withOtherSessions(page, playwright, 2);
    await page.goto(SECURITY_PATH);
    const sessions = page.getByRole('region', { name: 'Active sessions' });
    await expect(sessions.getByRole('button', { name: /^End session:/ })).toHaveCount(2);

    await sessions.getByRole('button', { name: 'End all other sessions' }).click();
    await expect(page.getByText('Your other sessions have ended.')).toBeVisible();
    await expect(sessions.getByRole('button', { name: /^End session:/ })).toHaveCount(0);
    await expect(sessions.getByRole('button', { name: 'End all other sessions' })).toHaveCount(0);
    expect(await Promise.all(others.map(isLive))).toEqual([false, false]);

    // This session is the one left.
    await page.reload();
    await expect(sessions.getByText('This device')).toBeVisible();
    await Promise.all(others.map((other) => other.dispose()));
  });
});

test('"Load more" adds the next page of the sign-in history', async ({ page, playwright }) => {
  test.slow();
  const school = await newSchool(playwright);
  await signInAndSetPassword(page.request, school);

  // Each round adds a sign-in and a sign-out to the history: a page holds 20.
  const other = await playwright.request.newContext();
  for (let i = 0; i < 12; i++) {
    await apiSignIn(other, school);
    const out = await post(other, '/auth/sign-out');
    expect(out.status(), await out.text()).toBe(204);
  }
  await other.dispose();

  await page.goto(SECURITY_PATH);
  const activity = page.getByRole('region', { name: 'Sign-in history' });
  const rows = visible(activity.locator('tbody tr, ul > li'));
  await expect(rows).toHaveCount(20);
  const loadMore = activity.getByRole('button', { name: 'Load more' });
  await loadMore.click();

  await expect.poll(() => rows.count()).toBeGreaterThan(20);
  // 12 rounds, the first sign-in, its code request and the password change: more than two pages
  // is not possible here, so there is nothing left to load.
  await expect(loadMore).toHaveCount(0);
});

test.describe('keyboard only', () => {
  test('completes the setup dialog without a pointer', async ({ page, playwright }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'Desktop keyboards only');
    const school = await newSchool(playwright);
    await signInWithCode(page.request, school);

    await page.goto(SECURITY_PATH);
    await expect(page.getByRole('button', { name: 'Turn on' })).toBeVisible();
    await page.getByRole('button', { name: 'Turn on' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('[data-slot="dialog-content"]');
    const shown = await dialog.getByText(/^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/).innerText();

    await tabTo(page, dialog.getByRole('button', { name: 'Next' }));
    await page.keyboard.press('Enter');
    // The code field has focus when the step opens; the 6th digit submits.
    await expect(dialog.getByLabel('Authenticator code')).toBeFocused();
    await page.keyboard.type(totpCode(shown.replace(/\s/g, '')));

    await expect(dialog.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
    await tabTo(page, dialog.getByRole('checkbox', { name: "I've saved these codes" }));
    await page.keyboard.press('Space');
    await tabTo(page, dialog.getByRole('button', { name: 'Done' }));
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('region', { name: 'Two-step sign-in' }).getByText('On', { exact: true }),
    ).toBeVisible();
  });
});

test.describe('no horizontal scroll on a phone', () => {
  test('the Security page, with its setup dialog, fits the screen', async ({
    page,
    playwright,
  }) => {
    test.skip(!isPhone(page), 'Phones only');
    const school = await newSchool(playwright);
    await signInAndSetPassword(page.request, school);
    // Sessions, history and devices all have rows to lay out.
    const other = await playwright.request.newContext();
    await apiSignIn(other, school);

    await page.goto(SECURITY_PATH);
    await expect(page.getByText('This device').first()).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Active sessions' })
        .getByRole('button', { name: /^End session:/ }),
    ).toBeVisible();
    await expect(
      visible(page.getByText('Signed in with a password', { exact: true })).first(),
    ).toBeVisible();
    expect(await noHorizontalOverflow(page), 'security page').toBe(true);

    const { dialog } = await openSetup(page);
    expect(await noHorizontalOverflow(page), 'setup dialog, scan step').toBe(true);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await other.dispose();
  });

  test('the two-step step fits the screen', async ({ page, playwright }) => {
    test.skip(!isPhone(page), 'Phones only');
    const school = await newSchool(playwright);
    const request = await playwright.request.newContext();
    await enableTwoFactorFor(request, school, PASSWORD);
    await request.dispose();

    await signInByPassword(page, school, PASSWORD);
    await expect(twoStepHeading(page)).toBeVisible();
    expect(await noHorizontalOverflow(page), 'app code').toBe(true);
    await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
    await expect(page.getByLabel('Recovery code')).toBeVisible();
    expect(await noHorizontalOverflow(page), 'recovery code').toBe(true);
  });
});
