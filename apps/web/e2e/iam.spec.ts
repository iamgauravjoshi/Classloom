import {
  type APIRequestContext,
  type Browser,
  expect,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs,
  test,
} from '@playwright/test';

import { inviteAs, type Invitee, newInvitee } from './support/invitations';
import { latestEmailTo, mailIds, verificationLink } from './support/mailpit';
import { createVerifiedSchool, signInWithCode, WEB_ORIGIN } from './support/school';
import { totpCode } from './support/totp';

// The staff journey of Part 3: invite, join, roles, permissions, deactivation. Each test has a
// school of its own and no saved sign-in, because they sign people in and out and change roles.
//
// Already covered elsewhere, so not repeated here:
// - join-and-setup.spec.ts: "previews, joins, welcomes, and the Teacher role sees only its pages"
//   (preview, join, access denied on typed addresses), "a person with two-step on is asked for the
//   app code" (existing account with two-step), "a spent link says it has expired", "offers Sign out
//   and join", and "sends a new owner to the setup page and on to the page asked for".
// - members.spec.ts: the invite dialog's validation, resend and revoke, role changes,
//   deactivate and reactivate, and "changing your own roles refreshes what the page offers".
// - roles.spec.ts: the grid, create/clone/edit/delete, "a viewer without iam.manage can look but
//   not change, and cannot grant what they lack", and the 375 px grid.
test.use({ storageState: { cookies: [], origins: [] } });

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const PASSWORD = 'ember lantern 42 quartz';

async function ownerPage(page: Page, playwright: PlaywrightWorkerArgs['playwright']) {
  const request = await playwright.request.newContext();
  const school = await createVerifiedSchool(request);
  await request.dispose();
  await signInWithCode(page.request, school);
  return school;
}

/** The main menu; below the `lg` breakpoint it is a sheet that the sidebar button opens. */
async function openNav(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  // The button only works once the page has hydrated: the dashboard's API check shows that.
  await expect(page.getByText('API online')).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) < 1024 && !(await nav.isVisible())) {
    await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  }
  return nav;
}

/** Accepts an invitation from a browser context of its own, signing that person in. */
async function acceptIn(context: { request: APIRequestContext }, link: string) {
  const joined = await context.request.post(`${WEB_ORIGIN}/api/invitations/accept`, {
    data: { token: new URL(link).searchParams.get('token') },
    headers: { origin: WEB_ORIGIN },
  });
  expect(joined.status(), await joined.text()).toBe(200);
}

/** A member who has joined under `roleName`, in a browser of their own. */
async function memberJoined(
  browser: Browser,
  baseURL: string | undefined,
  owner: Page,
  roleName: string,
  name: string,
) {
  const person = newInvitee(name);
  const link = await inviteAs(owner.request, person, roleName);
  const context = await browser.newContext({ baseURL });
  await acceptIn(context, link);
  return { person, context, page: await context.newPage() };
}

/** Opens "Change roles" for a member on the Users page and saves with `toggle` applied. */
async function changeRoles(
  page: Page,
  member: Invitee,
  toggle: (dialog: Locator) => Promise<void>,
) {
  await page.goto('/en/users-roles');
  await page.getByRole('button', { name: `Actions for ${member.name}` }).click();
  await page.getByRole('menuitem', { name: 'Change roles' }).click();
  const dialog = page.getByRole('dialog', { name: `Change roles for ${member.name}` });
  await toggle(dialog);
  await dialog.getByRole('button', { name: 'Save roles' }).click();
  await expect(page.getByText(`Roles updated for ${member.name}.`)).toBeVisible();
}

/** Tabs until `target` has focus (a long grid needs many presses). */
async function tabTo(page: Page, target: Locator, max = 20) {
  for (let i = 0; i < max && !(await target.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

test.describe('the staff journey', () => {
  test('the owner invites a teacher; they join from the email, set a password and see only Teacher pages', async ({
    page,
    browser,
    baseURL,
    playwright,
  }) => {
    test.slow();
    await ownerPage(page, playwright);
    const teacher = newInvitee('Ravi Kumar');

    await page.goto('/en/users-roles');
    await page.getByRole('button', { name: 'Invite people' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite people' });
    // Owner is a role an owner may give.
    await expect(dialog.getByRole('checkbox', { name: 'Owner', exact: true })).toBeVisible();
    const before = await mailIds(page.request, teacher.email);
    await dialog.getByLabel('Email').fill(teacher.email);
    await dialog.getByLabel('Name').fill(teacher.name);
    await dialog.getByRole('checkbox', { name: 'Teacher', exact: true }).click();
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText(`Invitation sent to ${teacher.email}.`)).toBeVisible();

    // The teacher opens the link in the email.
    const { text } = await latestEmailTo(
      page.request,
      teacher.email,
      /invited to join/,
      undefined,
      before,
    );
    const context = await browser.newContext({ baseURL });
    const own = await context.newPage();
    await own.goto(verificationLink(text));
    await expect(own.getByText('Join Global International School as Teacher.')).toBeVisible();
    await expect(own.getByText(`Invitation for ${teacher.name}`)).toBeVisible();
    await own.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(
      own.getByRole('heading', { level: 1, name: 'Welcome to Global International School' }),
    ).toBeVisible();

    // Setting a password is offered, and works.
    await own.getByRole('link', { name: 'Set a password' }).click();
    await expect(own).toHaveURL(/\/en\/account/);
    await own.getByLabel('New password', { exact: true }).fill(PASSWORD);
    await own.getByLabel('Confirm new password').fill(PASSWORD);
    await own.getByRole('button', { name: 'Set password' }).click();
    await expect(own.getByText('Your password has been set.')).toBeVisible();

    // The menu holds only what the Teacher role may open.
    await own.goto('/en/dashboard');
    const nav = await openNav(own);
    for (const item of ['Dashboard', 'Students', 'Classes & sections', 'Subjects', 'Timetable']) {
      await expect(nav.getByRole('link', { name: item, exact: true })).toBeVisible();
    }
    for (const item of ['Fees', 'Users & roles', 'Staff', 'Admissions', 'School profile']) {
      await expect(nav.getByRole('link', { name: item, exact: true })).toHaveCount(0);
    }
    await own.goto('/en/users-roles');
    await expect(
      own.getByRole('heading', { level: 2, name: "You don't have access to this page" }),
    ).toBeVisible();
    await context.close();
  });

  test('adding Accountant makes the next navigation land on the two-step setup', async ({
    page,
    browser,
    baseURL,
    playwright,
  }) => {
    test.slow();
    await ownerPage(page, playwright);
    const member = await memberJoined(browser, baseURL, page, 'Teacher', 'Meena Joshi');
    await member.page.goto('/en/dashboard');
    await expect(
      (await openNav(member.page)).getByRole('link', { name: 'Students' }),
    ).toBeVisible();

    await changeRoles(page, member.person, async (dialog) => {
      await dialog.getByRole('checkbox', { name: 'Accountant', exact: true }).click();
    });

    // The Accountant role requires two-step: the teacher's next navigation is sent to set it up.
    await member.page.goto('/en/students');
    await expect(member.page).toHaveURL(/\/en\/setup-two-factor\?next=%2Fen%2Fstudents$/);
    await expect(
      member.page.getByText('Your school requires two-step sign-in for your role.'),
    ).toBeVisible();
    await expect(member.page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);

    await expect(member.page.getByRole('img', { name: /QR code/ })).toBeVisible();
    const key = (await member.page.getByText(/^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/).innerText()).replace(
      /\s/g,
      '',
    );
    await member.page.getByRole('button', { name: 'Next' }).click();
    await member.page.getByLabel('Authenticator code').fill(totpCode(key));
    await expect(
      member.page.getByRole('heading', { name: 'Save your recovery codes' }),
    ).toBeVisible();
    await member.page.getByRole('checkbox', { name: "I've saved these codes" }).check();
    await member.page.getByRole('button', { name: 'Done' }).click();

    await expect(member.page).toHaveURL(/\/en\/students$/);
    // The Accountant role's pages came with it.
    await member.page.goto('/en/dashboard');
    await expect((await openNav(member.page)).getByRole('link', { name: 'Fees' })).toBeVisible();
    await member.context.close();
  });

  test('a custom role cloned from Teacher with fees.view gives the teacher Fees', async ({
    page,
    browser,
    baseURL,
    playwright,
  }) => {
    test.slow();
    await ownerPage(page, playwright);
    const member = await memberJoined(browser, baseURL, page, 'Teacher', 'Meena Joshi');
    await member.page.goto('/en/dashboard');
    const navLink = async (name: string) =>
      (await openNav(member.page)).getByRole('link', { name, exact: true });
    await expect(await navLink('Students')).toBeVisible();
    await expect(await navLink('Fees')).toHaveCount(0);

    await page.goto('/en/users-roles?tab=roles');
    await page.getByRole('link', { name: 'Clone Teacher' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Office Assistant');
    await page.getByRole('checkbox', { name: 'Fees: View' }).click();
    await page.getByRole('button', { name: 'Create role', exact: true }).click();
    await expect(page.getByText('Office Assistant was created.')).toBeVisible();
    // Let the editor finish returning to the list before going elsewhere.
    await expect(page).toHaveURL(/\/en\/users-roles\?tab=roles/);

    await changeRoles(page, member.person, async (dialog) => {
      await dialog.getByRole('checkbox', { name: 'Office Assistant', exact: true }).click();
    });

    // The next page load carries the new role; Fees opens.
    await member.page.reload();
    const fees = await navLink('Fees');
    await expect(fees).toBeVisible();
    await fees.click();
    await expect(member.page).toHaveURL(/\/en\/fees$/);
    await expect(member.page.getByRole('heading', { level: 1, name: 'Fees' })).toBeVisible();
    await member.context.close();
  });

  test('deactivating the teacher sends their open tab to sign-in', async ({
    page,
    browser,
    baseURL,
    playwright,
  }) => {
    test.slow();
    await ownerPage(page, playwright);
    const member = await memberJoined(browser, baseURL, page, 'Teacher', 'Meena Joshi');
    await member.page.goto('/en/dashboard');
    await expect(
      (await openNav(member.page)).getByRole('link', { name: 'Students' }),
    ).toBeVisible();

    await page.goto('/en/users-roles');
    await page.getByRole('button', { name: `Actions for ${member.person.name}` }).click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await page
      .getByRole('dialog', { name: `Deactivate ${member.person.name}?` })
      .getByRole('button', { name: 'Deactivate' })
      .click();
    await expect(page.getByText(`${member.person.name} was deactivated.`)).toBeVisible();

    await member.page.reload();
    await expect(member.page).toHaveURL(/\/en\/sign-in/);
    await member.context.close();
  });

  test('an Admin who is not an owner cannot give what they lack, and cannot give Owner', async ({
    page,
    browser,
    baseURL,
    playwright,
  }) => {
    test.slow();
    await ownerPage(page, playwright);
    // Admin holds every permission by default: narrow it by one, and drop its two-step requirement.
    const listed = await page.request.get(`${WEB_ORIGIN}/api/iam/roles`);
    const roles = (
      (await listed.json()) as {
        roles: { id: string; name: string; key: string | null; permissions: string[] }[];
      }
    ).roles;
    const adminRole = roles.find((role) => role.key === 'ADMIN');
    const ownerRole = roles.find((role) => role.key === 'OWNER');
    const accountantRole = roles.find((role) => role.key === 'ACCOUNTANT');
    expect(adminRole && ownerRole && accountantRole).toBeTruthy();
    const narrowed = await page.request.put(`${WEB_ORIGIN}/api/iam/roles/${adminRole?.id}`, {
      data: {
        permissions: adminRole?.permissions.filter((key) => key !== 'fees.approve'),
        requiresTwoFactor: false,
      },
      headers: { origin: WEB_ORIGIN },
    });
    expect(narrowed.status(), await narrowed.text()).toBe(200);

    const admin = await memberJoined(browser, baseURL, page, 'Admin', 'Dev Anand');
    const own = admin.page;

    // The grid: a box the Admin lacks is off-limits; one they hold is not.
    await own.goto('/en/users-roles/roles/new');
    await expect(own.getByRole('checkbox', { name: 'Fees: Approve' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(own.getByRole('checkbox', { name: 'Fees: View' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // The picker: no Owner to give.
    await own.goto('/en/users-roles');
    await own.getByRole('button', { name: 'Invite people' }).click();
    const dialog = own.getByRole('dialog', { name: 'Invite people' });
    await expect(dialog.getByRole('checkbox', { name: 'Teacher', exact: true })).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Owner', exact: true })).toHaveCount(0);

    // And the API agrees, for Owner and for a role carrying a permission the Admin lacks.
    for (const role of [ownerRole, accountantRole]) {
      const refused = await own.request.post(`${WEB_ORIGIN}/api/iam/invitations`, {
        data: { email: newInvitee().email, name: 'Someone', roleIds: [role?.id] },
        headers: { origin: WEB_ORIGIN },
      });
      expect(refused.status(), role?.name).toBe(403);
    }
    await admin.context.close();
  });

  test('an existing account at another school joins with one click', async ({
    page,
    playwright,
  }) => {
    test.slow();
    const request = await playwright.request.newContext();
    // The invitee already owns another school, with no two-step.
    const home = await createVerifiedSchool(request, { schoolName: 'Home School' });
    const school = await createVerifiedSchool(request, { schoolName: 'Riverside Public School' });
    await request.dispose();
    await signInWithCode(page.request, school);
    const link = await inviteAs(page.request, { email: home.email, name: home.name });
    await page.context().clearCookies();

    await page.goto(link);
    await expect(page.getByText('Join Riverside Public School as Teacher.')).toBeVisible();
    // No password, no code: the person is already someone, so the one button does it all.
    await expect(page.getByLabel(/password/i)).toHaveCount(0);
    await page.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Welcome to Riverside Public School' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });

  test('an existing owner is sent to setup once the Owner role requires two-step', async ({
    page,
    playwright,
  }) => {
    test.slow();
    await ownerPage(page, playwright);
    // Working in the app today: the Owner role's requirement is off for this school.
    await page.goto('/en/students');
    await expect(page.getByRole('heading', { level: 1, name: 'Students' })).toBeVisible();

    await page.goto('/en/users-roles?tab=roles');
    await page.getByRole('link', { name: 'Edit Owner' }).click();
    const twoStep = page.getByRole('switch', { name: 'Require two-step sign-in' });
    await expect(twoStep).not.toBeChecked();
    await twoStep.click();
    await page.getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByText('Owner was saved.')).toBeVisible();

    // The first visit after that goes to setup, and on to the page asked for once done.
    // A save that lands first may redirect the editor itself; try the visit until it settles.
    await expect(async () => {
      await page.goto('/en/students');
      await expect(page).toHaveURL(/\/en\/setup-two-factor\?next=%2Fen%2Fstudents$/, {
        timeout: 3_000,
      });
    }).toPass({ timeout: 20_000 });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Set up two-step sign-in' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /skip|turn off/i })).toHaveCount(0);
  });
});

test.describe('keyboard and layout', () => {
  test('the invite dialog and the role editor can be completed by keyboard', async ({
    page,
    playwright,
  }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'Desktop keyboards only');
    test.slow();
    await ownerPage(page, playwright);
    const invitee = newInvitee('Ravi Kumar');

    await page.goto('/en/users-roles');
    const invite = page.getByRole('button', { name: 'Invite people' });
    await expect(invite).toBeVisible();
    await invite.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Invite people' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Email').focus();
    await page.keyboard.type(invitee.email);
    await page.keyboard.press('Tab');
    await expect(dialog.getByLabel('Name')).toBeFocused();
    await page.keyboard.type(invitee.name);
    await tabTo(page, dialog.getByRole('checkbox', { name: 'Teacher', exact: true }));
    await page.keyboard.press('Space');
    await tabTo(page, dialog.getByRole('button', { name: 'Send invitation' }));
    await page.keyboard.press('Enter');
    await expect(page.getByText(`Invitation sent to ${invitee.email}.`)).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(invite).toBeFocused();

    // The role editor: name, one box, and the save button, with no pointer.
    await page.goto('/en/users-roles/roles/new');
    await page.getByLabel('Name', { exact: true }).focus();
    await page.keyboard.type('Desk keys');
    const box = page.getByRole('checkbox', { name: 'Attendance: View' });
    await tabTo(page, box, 400);
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
    await tabTo(page, page.getByRole('button', { name: 'Create role', exact: true }), 400);
    await page.keyboard.press('Enter');
    await expect(page.getByText('Desk keys was created.')).toBeVisible();
  });

  test('the invite dialog and the role editor fit the screen', async ({ page, playwright }) => {
    await ownerPage(page, playwright);
    await page.goto('/en/users-roles');
    await page.getByRole('button', { name: 'Invite people' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite people' });
    await expect(dialog.getByRole('checkbox', { name: 'Teacher', exact: true })).toBeVisible();
    expect(await noHorizontalOverflow(page), 'invite dialog').toBe(true);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    // Tall as it is, the dialog stays inside the screen and scrolls: its buttons can be reached.
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    for (const name of ['Cancel', 'Send invitation']) {
      const button = dialog.getByRole('button', { name });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
    }

    await page.goto('/en/users-roles/roles/new');
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
    expect(await noHorizontalOverflow(page), 'role editor').toBe(true);
  });
});
