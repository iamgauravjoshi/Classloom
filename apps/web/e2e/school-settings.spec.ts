import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
  type PlaywrightWorkerArgs,
  test,
} from '@playwright/test';

import { inviteAs, newInvitee } from './support/invitations';
import {
  closeToasts,
  createVerifiedSchool,
  setUpCurrentYear,
  signInWithCode,
  uploadLogo,
  type VerifiedSchool,
  WEB_ORIGIN,
} from './support/school';

// The school's Settings pages (spec §6, §7, §10): academic years, campuses and read-only access.
// Every test changes its school's settings, so each registers a school of its own.
test.use({ storageState: { cookies: [], origins: [] } });

/** Viewports narrower than Tailwind's lg show the sidebar as an off-canvas sheet. */
const isSheetLayout = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;

/** A new school, its owner signed in to `page` (past the setup wizard). */
async function ownerPage(
  page: Page,
  playwright: PlaywrightWorkerArgs['playwright'],
): Promise<VerifiedSchool> {
  const request = await playwright.request.newContext();
  const school = await createVerifiedSchool(request);
  await request.dispose();
  await signInWithCode(page.request, school);
  return school;
}

/** A card (or, below md, a row) of a Settings list, found by its level-2 heading. */
const cardOf = (page: Page, name: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) });

/** The main menu; below the `lg` breakpoint it is a sheet that the sidebar button opens. */
async function openNav(page: Page) {
  await expect(page.getByText('API online')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  if (isSheetLayout(page)) {
    await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  }
  await expect(nav).toBeVisible();
  return nav;
}

test('preparing next year and making it current closes the old year', async ({
  page,
  playwright,
}) => {
  test.slow();
  await ownerPage(page, playwright);
  const current = await setUpCurrentYear(page.request);
  const start = Number(current.startsOn.slice(0, 4)) + 1;
  const next = `${start}–${String(start + 1).slice(2)}`;

  await page.goto('/en/settings/academic-years');
  await expect(cardOf(page, current.label).getByText('Current', { exact: true })).toBeVisible();

  // "Prepare next year" pre-fills the year after the current one.
  await page.getByRole('button', { name: 'Prepare next year' }).click();
  const form = page.getByRole('dialog', { name: 'Prepare next year' });
  await expect(form.getByLabel('Starts on', { exact: true })).toHaveValue(`01/04/${start}`);
  await expect(form.getByLabel('Ends on', { exact: true })).toHaveValue(`31/03/${start + 1}`);
  await expect(form.getByLabel('Label', { exact: true })).toHaveValue(next);
  await form.getByRole('button', { name: 'Create year' }).click();
  await expect(form).toHaveCount(0);
  await closeToasts(page);
  await expect(cardOf(page, next).getByText('Planned', { exact: true })).toBeVisible();
  // One planned year at a time.
  await expect(page.getByRole('button', { name: 'Prepare next year' })).toHaveCount(0);

  // Making it current asks first: it starts later, and the current year will close.
  await page.getByRole('button', { name: `Make current: ${next}` }).click();
  const question = page.getByRole('dialog', { name: `Make ${next} the current year?` });
  await expect(
    question.getByText(`${next} starts on 01/04/${start}. Make it current now?`),
  ).toBeVisible();
  await expect(
    question.getByText(`${current.label} will be closed and can't be changed afterwards.`),
  ).toBeVisible();
  await question.getByRole('button', { name: 'Make current' }).click();
  await expect(question).toHaveCount(0);
  await closeToasts(page);

  // The old year is closed, with nothing left to do to it.
  const closed = cardOf(page, current.label);
  await expect(closed.getByText('Closed', { exact: true })).toBeVisible();
  await expect(closed.getByRole('button')).toHaveCount(0);
  await expect(cardOf(page, next).getByText('Current', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Make current: ${next}` })).toHaveCount(0);

  // The year switcher follows the new current year, and remembers another choice across a reload.
  await page.reload();
  // The list draws once the browser has fetched it, so the page has hydrated.
  await expect(cardOf(page, next).getByText('Current', { exact: true })).toBeVisible();
  const switcher = page.getByRole('button', { name: /^AY / });
  await expect(switcher).toHaveAccessibleName(`AY ${next}`);
  await switcher.click();
  await expect(page.getByRole('menuitemradio', { name: `${next} (current)` })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitemradio', { name: current.label, exact: true }).click();
  await expect(switcher).toHaveAccessibleName(`AY ${current.label}`);
  await page.reload();
  await expect(page.getByRole('button', { name: /^AY / })).toHaveAccessibleName(
    `AY ${current.label}`,
  );
});

test('a second campus can become primary, and the old primary can then be deactivated', async ({
  page,
  playwright,
}) => {
  test.slow();
  const school = await ownerPage(page, playwright);
  const main = school.schoolName;

  await page.goto('/en/settings/campuses');
  await expect(cardOf(page, main).getByText('Primary', { exact: true })).toBeVisible();

  // Add a campus.
  await page.getByRole('button', { name: 'Add campus' }).click();
  const form = page.getByRole('dialog', { name: 'Add campus' });
  await form.getByLabel('Campus name').fill('North Campus');
  await form.getByLabel('Address line 1').fill('12 Rajpur Road');
  await form.getByLabel('PIN code').fill('248001');
  await form.getByRole('button', { name: 'Add campus' }).click();
  await expect(form).toHaveCount(0);
  await closeToasts(page);
  await expect(cardOf(page, 'North Campus').getByText('Active', { exact: true })).toBeVisible();

  // The primary campus offers no Deactivate, and the page says why.
  await expect(
    page.getByText("The primary campus comes first and can't be deactivated.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: `Deactivate ${main}` })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Make primary: ${main}` })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deactivate North Campus' })).toBeVisible();

  // Move the primary flag, then deactivate the old primary campus.
  await page.getByRole('button', { name: 'Make primary: North Campus' }).click();
  await closeToasts(page);
  await expect(cardOf(page, 'North Campus').getByText('Primary', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deactivate North Campus' })).toHaveCount(0);
  await page.getByRole('button', { name: `Deactivate ${main}` }).click();
  const question = page.getByRole('dialog', { name: `Deactivate ${main}?` });
  await question.getByRole('button', { name: 'Deactivate' }).click();
  await expect(question).toHaveCount(0);
  await closeToasts(page);
  await expect(cardOf(page, main).getByText('Inactive', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Reactivate ${main}` })).toBeVisible();

  // The campus switcher offers only the active campus.
  await page.goto('/en/dashboard');
  await expect(page.getByText('API online')).toBeVisible();
  if (isSheetLayout(page)) {
    await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  }
  await page.getByRole('button', { name: /North Campus/ }).click();
  await expect(page.getByRole('menuitemradio', { name: 'North Campus (primary)' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('menuitemradio')).toHaveCount(1);
});

test.describe('read-only access', () => {
  /** Joins `school` under `roleName` from a browser of its own, signed in. */
  async function joinAs(
    browser: Browser,
    baseURL: string | undefined,
    owner: APIRequestContext,
    roleName: string,
  ) {
    const link = await inviteAs(owner, newInvitee('Meera Joshi'), roleName);
    const context = await browser.newContext({ baseURL });
    const joined = await context.request.post(`${WEB_ORIGIN}/api/invitations/accept`, {
      data: { token: new URL(link).searchParams.get('token') },
      headers: { origin: WEB_ORIGIN },
    });
    expect(joined.status(), await joined.text()).toBe(200);
    return { context, page: await context.newPage() };
  }

  test('a Teacher whose role adds settings.view sees Settings without edit controls', async ({
    page,
    browser,
    baseURL,
    playwright,
  }) => {
    test.slow();
    const school = await ownerPage(page, playwright);
    const year = await setUpCurrentYear(page.request);
    await uploadLogo(page.request);

    // A custom role: everything the Teacher role has, plus viewing Settings.
    const roles = await page.request.get(`${WEB_ORIGIN}/api/iam/roles`);
    expect(roles.status(), await roles.text()).toBe(200);
    const teacher = (
      (await roles.json()) as { roles: { key: string | null; permissions: string[] }[] }
    ).roles.find((role) => role.key === 'TEACHER');
    expect(teacher).toBeDefined();
    const created = await page.request.post(`${WEB_ORIGIN}/api/iam/roles`, {
      data: {
        name: 'Teacher with settings',
        permissions: [...teacher!.permissions, 'settings.view'],
        requiresTwoFactor: false,
      },
      headers: { origin: WEB_ORIGIN },
    });
    expect(created.status(), await created.text()).toBe(201);
    const member = await joinAs(browser, baseURL, page.request, 'Teacher with settings');
    const own = member.page;

    // The Settings group lists the three pages.
    await own.goto('/en/dashboard');
    const nav = await openNav(own);
    await expect(nav.getByText('Settings', { exact: true })).toBeVisible();
    for (const name of ['School profile', 'Academic years', 'Campuses']) {
      await expect(nav.getByRole('link', { name })).toBeVisible();
    }

    await own.goto('/en/settings/school-profile');
    await expect(
      own.getByText(
        'You can view the school profile. Ask someone who manages settings to change it.',
      ),
    ).toBeVisible();
    await expect(own.getByText(school.schoolName).first()).toBeVisible();
    await expect(own.getByRole('img', { name: 'School logo' })).toBeVisible();
    for (const name of ['Save changes', 'Upload logo', 'Replace', 'Remove']) {
      await expect(own.getByRole('button', { name })).toHaveCount(0);
    }
    await expect(own.locator('#main').getByRole('textbox')).toHaveCount(0);

    await own.goto('/en/settings/academic-years');
    await expect(
      own.getByText(
        'You can view the academic years. Only people who manage settings can change them.',
      ),
    ).toBeVisible();
    await expect(cardOf(own, year.label).getByText('Current', { exact: true })).toBeVisible();
    await expect(own.locator('#main').getByRole('button')).toHaveCount(0);

    await own.goto('/en/settings/campuses');
    await expect(
      own.getByText('You can view the campuses. Only people who manage settings can change them.'),
    ).toBeVisible();
    await expect(
      cardOf(own, school.schoolName).getByText('Primary', { exact: true }),
    ).toBeVisible();
    await expect(own.locator('#main').getByRole('button')).toHaveCount(0);

    // The wizard is for people who manage settings.
    await own.goto('/en/onboarding');
    await expect(
      own.getByRole('heading', { level: 2, name: "You don't have access to this page" }),
    ).toBeVisible();
    await member.context.close();
  });

  test('a plain Teacher has no Settings group, and a typed address is refused', async ({
    page,
    browser,
    baseURL,
    playwright,
  }) => {
    await ownerPage(page, playwright);
    const member = await joinAs(browser, baseURL, page.request, 'Teacher');
    const own = member.page;

    await own.goto('/en/dashboard');
    const nav = await openNav(own);
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByText('Settings', { exact: true })).toHaveCount(0);
    for (const name of ['School profile', 'Academic years', 'Campuses']) {
      await expect(nav.getByRole('link', { name })).toHaveCount(0);
    }

    for (const path of ['school-profile', 'academic-years', 'campuses']) {
      await own.goto(`/en/settings/${path}`);
      await expect(
        own.getByRole('heading', { level: 2, name: "You don't have access to this page" }),
        path,
      ).toBeVisible();
    }
    await member.context.close();
  });
});
