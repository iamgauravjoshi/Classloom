import { expect, type Page, type PlaywrightWorkerArgs, test } from '@playwright/test';

import {
  closeToasts,
  createVerifiedSchool,
  currentAcademicYear,
  LOGO_JPEG,
  relaxOwnerTwoFactor,
  signInWithCode,
  signInWithCodeKeepingRequirement,
  type VerifiedSchool,
  WEB_ORIGIN,
} from './support/school';

// The first-run setup wizard (spec §9) and the dashboard checklist that takes over from it. Every
// test changes its school's setup, so each registers a school of its own.
test.use({ storageState: { cookies: [], origins: [] } });

/** Viewports narrower than Tailwind's lg show the sidebar as an off-canvas sheet. */
const isSheetLayout = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const stepHeading = (page: Page, name: string) =>
  page.getByRole('heading', { level: 2, name, exact: true });

const PASSWORD = 'ember lantern 42 quartz';

/**
 * The wizard's steps, each with something that only draws once the step's data has loaded in the
 * browser. The headings and the loading state's Skip button are in the server's HTML, and a click
 * before the page has hydrated would do nothing.
 */
const STEPS = [
  { heading: 'School profile', ready: (page: Page) => page.getByLabel('School name') },
  {
    heading: 'School logo',
    ready: (page: Page) => page.getByRole('button', { name: 'Upload logo' }),
  },
  { heading: 'Academic year', ready: (page: Page) => page.getByLabel('Term 2 ends on') },
  {
    heading: 'Campuses',
    ready: (page: Page) => page.getByRole('button', { name: 'Add another campus' }),
  },
];

/** Counts the browser's `POST /onboarding/start` calls (the wizard sends one when it mounts). */
function countStarts(page: Page): { count: number } {
  const starts = { count: 0 };
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/school/onboarding/start')) {
      starts.count += 1;
    }
  });
  return starts;
}

const checklistHeading = (page: Page) =>
  page.getByRole('heading', { level: 2, name: 'Finish setting up your school' });

/**
 * A new school whose owner is signed in as a real new owner is (the setup wizard not yet seen),
 * but without the Owner role's two-step requirement, so the dashboard is open to them.
 */
async function newOwner(
  page: Page,
  playwright: PlaywrightWorkerArgs['playwright'],
): Promise<VerifiedSchool> {
  const request = await playwright.request.newContext();
  const school = await createVerifiedSchool(request);
  await request.dispose();
  await signInWithCodeKeepingRequirement(page.request, school);
  await relaxOwnerTwoFactor(page.request);
  return school;
}

/** The dashboard, once hydrated ("API online" appears after the client's first fetch). */
async function openDashboard(page: Page) {
  await page.goto('/en/dashboard');
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  await expect(page.getByText('API online')).toBeVisible();
}

test('a new owner is sent to the wizard, completes every step and lands on a finished dashboard', async ({
  page,
  playwright,
}) => {
  test.slow();
  const school = await newOwner(page, playwright);
  const year = currentAcademicYear();
  // The wizard stays mounted from the first step to the last, so it records the start once.
  const starts = countStarts(page);

  // The first dashboard visit opens the wizard.
  await page.goto('/en/dashboard');
  await expect(page).toHaveURL(/\/en\/onboarding$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Set up your school' })).toBeVisible();

  // 1. Profile: the four fields the checklist looks for.
  await expect(stepHeading(page, 'School profile')).toBeVisible();
  // The form draws once the browser has fetched the profile, which a busy run can slow down.
  await expect(page.getByLabel('School name')).toHaveValue(school.schoolName, { timeout: 15_000 });
  await page.getByLabel('UDISE+ code').fill('05060100101');
  await page.getByLabel('Phone number').fill('9412345678');
  await page.getByLabel('Address line 1').fill('14 Rajpur Road');
  await page.getByLabel('PIN code').fill('248001');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // 2. Logo: a JPEG, previewed once saved.
  await expect(stepHeading(page, 'School logo')).toBeVisible();
  await expect(page).toHaveURL(/\?step=logo$/);
  await page.getByLabel('Choose a logo image').setInputFiles(LOGO_JPEG);
  await expect(page.getByRole('img', { name: 'School logo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replace' })).toBeVisible();
  // On a wide screen the step's buttons are in the card, and a toast can sit over them; on a
  // phone they stick to the bottom and toasts rise above them (the 375 px test below).
  await closeToasts(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // 3. Academic year: 3 terms, the default dates and label.
  await expect(stepHeading(page, 'Academic year')).toBeVisible();
  await page.getByRole('radio', { name: '3 terms' }).check();
  await expect(page.getByLabel('Term 3 ends on')).toBeVisible();
  await expect(page.getByLabel('Label', { exact: true })).toHaveValue(year.label);
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // 4. Campuses: a second campus, then the primary campus's address. Typing can start at once:
  // the wizard is not mounted afresh after the year's save.
  await expect(stepHeading(page, 'Campuses')).toBeVisible();
  await closeToasts(page);
  const others = page.getByRole('region', { name: 'Other campuses' });
  await others.getByRole('button', { name: 'Add another campus' }).click();
  await others.getByLabel('Campus name').fill('North Campus');
  await others.getByRole('button', { name: 'Add campus' }).click();
  await expect(
    others.getByRole('list', { name: 'Campuses added' }).getByText('North Campus was added.'),
  ).toBeVisible();
  await closeToasts(page);

  const primary = page.getByRole('region', { name: `${school.schoolName} (primary campus)` });
  await primary.getByLabel('Address line 1').fill('14 Rajpur Road');
  await primary.getByLabel('PIN code').fill('248001');
  // Every step is ticked off in the stepper before the last save.
  const stepper = page.getByRole('navigation', { name: 'Setup steps' });
  for (const name of ['Profile', 'Logo', 'Academic year']) {
    await expect(
      stepper.getByRole('button', { name: new RegExp(`^${name}\\s*Done$`) }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: 'Save and finish' }).click();

  // The dashboard: every wizard step done; only academics, which the wizard leaves to the classes
  // page, is left on the checklist.
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  expect(starts.count).toBe(1);
  await expect(page.getByText('API online')).toBeVisible();
  await expect(page.getByText(`Academic year ${year.label}`, { exact: false })).toBeVisible();
  await expect(page.getByText('4 of 5 done')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Add sections and class subjects (to do)' }),
  ).toHaveAttribute('href', '/en/classes');

  // The year switcher lists the new year as current.
  await expect(page.getByRole('button', { name: `AY ${year.label}` })).toBeVisible();
  await page.getByRole('button', { name: `AY ${year.label}` }).click();
  await expect(
    page.getByRole('menuitemradio', { name: `${year.label} (current)` }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  // The sidebar shows the logo, and the campus switcher lists both campuses.
  if (isSheetLayout(page)) {
    await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  }
  const campusSwitcher = page.getByRole('button', { name: new RegExp(school.schoolName) });
  await expect(campusSwitcher.locator('img[src*="/api/school/logo?v="]')).toBeVisible();
  await campusSwitcher.click();
  await expect(
    page.getByRole('menuitemradio', { name: `${school.schoolName} (primary)` }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio', { name: 'North Campus' })).toBeVisible();
});

test('a new owner who skips everything keeps the checklist, and the wizard never returns', async ({
  page,
  playwright,
}) => {
  test.slow();
  const school = await newOwner(page, playwright);
  // A password, to sign in again within the minute an emailed code has to wait.
  const set = await page.request.put(`${WEB_ORIGIN}/api/me/password`, {
    data: { newPassword: PASSWORD },
    headers: { origin: WEB_ORIGIN },
  });
  expect(set.status(), await set.text()).toBe(204);

  await page.goto('/en/dashboard');
  await expect(page).toHaveURL(/\/en\/onboarding$/);
  for (const step of STEPS) {
    await expect(stepHeading(page, step.heading)).toBeVisible();
    // The first fetch in a new browser can take a while on a busy run.
    await expect(step.ready(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Skip' }).click();
  }

  // Skipping the last step finishes on the dashboard, with nothing done.
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  await expect(checklistHeading(page)).toBeVisible();
  await expect(page.getByText('0 of 5 done')).toBeVisible();

  // A reload doesn't open the wizard again…
  await page.reload();
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  await expect(page.getByText('0 of 5 done')).toBeVisible();

  // …and neither does a new session.
  await expect(page.getByText('API online')).toBeVisible();
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/en\/sign-in$/);
  await page.goto(`/en/sign-in?school=${school.code}`);
  await page.getByLabel('Email or mobile number').fill(school.email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  await expect(page.getByText('API online')).toBeVisible();
  await expect(page.getByText('0 of 5 done')).toBeVisible();
  await openDashboard(page);
  await expect(page.getByText('0 of 5 done')).toBeVisible();

  // A step finished in Settings counts.
  await page.goto('/en/settings/academic-years');
  await page.getByRole('button', { name: 'Set up academic year' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set up academic year' });
  await dialog.getByRole('button', { name: 'Create year' }).click();
  await expect(dialog).toHaveCount(0);
  const { label } = currentAcademicYear();
  await expect(page.getByRole('heading', { level: 2, name: label, exact: true })).toBeVisible();

  await openDashboard(page);
  await expect(page.getByText('1 of 5 done')).toBeVisible();

  // Dismissed, the card is gone, and stays gone.
  await page
    .getByRole('region', { name: 'Finish setting up your school' })
    .getByRole('button', { name: 'Dismiss' })
    .click();
  await expect(checklistHeading(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('API online')).toBeVisible();
  await expect(checklistHeading(page)).toHaveCount(0);
});

test('no wizard step scrolls sideways at 375 px', async ({ page, playwright }) => {
  const request = await playwright.request.newContext();
  const school = await createVerifiedSchool(request);
  await request.dispose();
  await signInWithCode(page.request, school);
  await page.setViewportSize({ width: 375, height: 812 });

  await page.goto('/en/onboarding');
  for (const [index, step] of STEPS.entries()) {
    const name = step.heading;
    await expect(stepHeading(page, name)).toBeVisible();
    // The first fetch in a new browser can take a while on a busy run.
    await expect(step.ready(page)).toBeVisible({ timeout: 15_000 });
    if (name === 'Campuses') {
      await page.getByRole('button', { name: 'Add another campus' }).click();
      await expect(page.getByLabel('Campus name')).toHaveCount(2);
    }
    expect(await noHorizontalOverflow(page), name).toBe(true);
    if (index < STEPS.length - 1) await page.getByRole('button', { name: 'Skip' }).click();
  }
});

test('Save and finish asks before dropping a half-filled "Add another campus" form', async ({
  page,
  playwright,
}) => {
  const school = await newOwner(page, playwright);
  await page.goto('/en/onboarding?step=campuses');
  await expect(stepHeading(page, 'Campuses')).toBeVisible();
  await expect(STEPS[3]!.ready(page)).toBeVisible({ timeout: 15_000 });

  const others = page.getByRole('region', { name: 'Other campuses' });
  await others.getByRole('button', { name: 'Add another campus' }).click();
  await others.getByLabel('Campus name').fill('North Campus');
  const primary = page.getByRole('region', { name: `${school.schoolName} (primary campus)` });
  await primary.getByLabel('PIN code').fill('248001');
  await page.getByRole('button', { name: 'Save and finish' }).click();

  // The primary campus is saved, but the wizard stays and asks about the other form.
  const question = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Stay' }).click();
  await expect(question).toHaveCount(0);
  await expect(page).toHaveURL(/\/en\/onboarding/);
  await expect(others.getByLabel('Campus name')).toHaveValue('North Campus');

  // Leaving anyway finishes on the dashboard.
  await page.getByRole('button', { name: 'Save and finish' }).click();
  await question.getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(/\/en\/dashboard$/);
});

test('a link to another ?step= is followed while the wizard is open', async ({
  page,
  playwright,
}) => {
  await newOwner(page, playwright);
  const starts = countStarts(page);
  await page.goto('/en/onboarding');
  await expect(STEPS[0]!.ready(page)).toBeVisible({ timeout: 15_000 });

  // With no year yet, the year switcher offers "Set up academic year": the wizard's year step.
  await page.getByRole('button', { name: /^AY / }).click();
  await page.getByRole('menuitem', { name: 'Set up academic year' }).click();
  await expect(page).toHaveURL(/\?step=academicYear$/);
  await expect(stepHeading(page, 'Academic year')).toBeVisible();
  await expect(stepHeading(page, 'Academic year')).toBeFocused();
  expect(starts.count).toBe(1);
});

test("at 375 px a toast sits above the wizard's sticky actions, not over them", async ({
  page,
  playwright,
}) => {
  await newOwner(page, playwright);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/en/onboarding?step=logo');
  await expect(STEPS[1]!.ready(page)).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Choose a logo image').setInputFiles(LOGO_JPEG);

  const toast = page
    .locator('[data-slot="toast"]')
    .filter({ hasText: 'The logo has been updated.' });
  await expect(toast).toBeVisible();
  const actions = page.locator('[data-slot="step-actions"]');
  // Measured once the toast has finished sliding in.
  await expect(async () => {
    const toastBox = (await toast.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;
    expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(actionsBox.y);
  }).toPass({ timeout: 5_000 });
  // Continue can be pressed without closing the toast first.
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(stepHeading(page, 'Academic year')).toBeVisible();
});
