import { expect, type Locator, type Page, type PlaywrightWorkerArgs, test } from '@playwright/test';

import { inviteAs, newInvitee } from './support/invitations';
import { latestEmailTo, mailIds } from './support/mailpit';
import { createVerifiedSchool, signInWithCode, WEB_ORIGIN } from './support/school';

// Each test has a school of its own and no saved sign-in: they change people and roles.
test.use({ storageState: { cookies: [], origins: [] } });

// The list is drawn twice (table and cards); only one shows.
const visible = (locator: Locator) => locator.filter({ visible: true });
const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function ownerPage(page: Page, playwright: PlaywrightWorkerArgs['playwright']) {
  const request = await playwright.request.newContext();
  const school = await createVerifiedSchool(request);
  await request.dispose();
  await signInWithCode(page.request, school);
  return school;
}

test.describe('members and invitations', () => {
  test('invites from the dialog, resends and revokes, with focus back on the menu button', async ({
    page,
    playwright,
  }) => {
    const school = await ownerPage(page, playwright);
    const invitee = newInvitee('Ravi Kumar');

    await page.goto('/en/users-roles');
    await expect(visible(page.getByText(school.email)).first()).toBeVisible();

    await page.getByRole('button', { name: 'Invite people' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite people' });
    // Nothing chosen yet: the form says what is missing.
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(dialog.getByText('Enter a valid email address.')).toBeVisible();
    await expect(dialog.getByText('Choose at least one role.')).toBeVisible();

    const before = await mailIds(page.request, invitee.email);
    await dialog.getByLabel('Email').fill(invitee.email);
    await dialog.getByLabel('Name').fill(invitee.name);
    await dialog.getByRole('checkbox', { name: 'Teacher', exact: true }).click();
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText(`Invitation sent to ${invitee.email}.`)).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Invite people' })).toBeFocused();
    await latestEmailTo(page.request, invitee.email, /invited to join/, undefined, before);

    // The same address again: refused on the email field.
    await page.getByRole('button', { name: 'Invite people' }).click();
    await dialog.getByLabel('Email').fill(invitee.email);
    await dialog.getByLabel('Name').fill(invitee.name);
    await dialog.getByRole('checkbox', { name: 'Teacher', exact: true }).click();
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(dialog.getByText(/already has an open invitation/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // The invitation is a row with status Invited.
    await expect(visible(page.getByText(invitee.email)).first()).toBeVisible();
    await page.getByLabel('Status').click();
    await page.getByRole('option', { name: 'Invited' }).click();
    await expect(page.getByText(school.email)).toHaveCount(0);

    const menu = page.getByRole('button', { name: `Actions for ${invitee.name}` });
    await menu.click();
    await page.getByRole('menuitem', { name: 'Resend invitation' }).click();
    await expect(page.getByText(`Invitation sent again to ${invitee.email}.`)).toBeVisible();

    await menu.click();
    await page.getByRole('menuitem', { name: 'Revoke invitation' }).click();
    const confirm = page.getByRole('dialog', {
      name: `Revoke the invitation for ${invitee.name}?`,
    });
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(menu).toBeFocused();

    await menu.click();
    await page.getByRole('menuitem', { name: 'Revoke invitation' }).click();
    await confirm.getByRole('button', { name: 'Revoke invitation' }).click();
    await expect(page.getByText(`Invitation for ${invitee.name} was revoked.`)).toBeVisible();
    await expect(page.getByText(invitee.email)).toHaveCount(0);
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test('changes roles, deactivates and reactivates a member, and keeps the owner safe', async ({
    page,
    playwright,
  }) => {
    const school = await ownerPage(page, playwright);
    const member = newInvitee('Meena Joshi');
    const link = await inviteAs(page.request, member);
    // The invitee joins from a browser of their own.
    const joiner = await playwright.request.newContext();
    const joined = await joiner.post(`${WEB_ORIGIN}/api/invitations/accept`, {
      data: { token: new URL(link).searchParams.get('token') },
      headers: { origin: WEB_ORIGIN },
    });
    expect(joined.status(), await joined.text()).toBe(200);

    await page.goto('/en/users-roles');
    const menu = page.getByRole('button', { name: `Actions for ${member.name}` });
    await expect(menu).toBeVisible();

    // The owner's own row offers no Deactivate and no Reset two-step.
    await page.getByRole('button', { name: `Actions for ${school.name}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Change roles' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Deactivate' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Reset two-step' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem')).toHaveCount(0);

    await menu.click();
    await page.getByRole('menuitem', { name: 'Change roles' }).click();
    const roles = page.getByRole('dialog', { name: `Change roles for ${member.name}` });
    await roles.getByRole('checkbox', { name: 'Teacher', exact: true }).click();
    await roles.getByRole('button', { name: 'Save roles' }).click();
    await expect(roles.getByText('Choose at least one role.')).toBeVisible();
    await roles.getByRole('checkbox', { name: 'Librarian', exact: true }).click();
    await roles.getByRole('button', { name: 'Save roles' }).click();
    await expect(page.getByText(`Roles updated for ${member.name}.`)).toBeVisible();
    await expect(visible(page.getByText('Librarian')).first()).toBeVisible();

    await menu.click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    const confirm = page.getByRole('dialog', { name: `Deactivate ${member.name}?` });
    await expect(
      confirm.getByText(
        "They'll be signed out now and can't sign in to this school until reactivated.",
      ),
    ).toBeVisible();
    await confirm.getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByText(`${member.name} was deactivated.`)).toBeVisible();

    await page.getByLabel('Status').click();
    await page.getByRole('option', { name: 'Deactivated' }).click();
    await expect(visible(page.getByText(member.email)).first()).toBeVisible();
    await expect(page.getByText(school.email)).toHaveCount(0);

    await menu.click();
    await page.getByRole('menuitem', { name: 'Reactivate' }).click();
    await expect(page.getByText(`${member.name} was reactivated.`)).toBeVisible();
    await expect(page.getByText(member.email)).toHaveCount(0);

    // A search matches the name or the email.
    await page.getByLabel('Status').click();
    await page.getByRole('option', { name: 'All statuses' }).click();
    await page.getByLabel('Search members').fill('meena');
    await expect(visible(page.getByText(member.email)).first()).toBeVisible();
    await expect(page.getByText(school.email)).toHaveCount(0);
    await joiner.dispose();
  });

  test('changing your own roles refreshes what the page offers', async ({
    page,
    browser,
    baseURL,
    playwright,
  }) => {
    await ownerPage(page, playwright);
    // Two custom roles with no two-step requirement: one that manages, one that only views.
    for (const [name, permissions] of [
      ['Manager', ['dashboard.view', 'iam.view', 'iam.manage']],
      ['Viewer', ['dashboard.view', 'iam.view']],
    ] as const) {
      const created = await page.request.post(`${WEB_ORIGIN}/api/iam/roles`, {
        data: { name, permissions, requiresTwoFactor: false },
        headers: { origin: WEB_ORIGIN },
      });
      expect(created.status(), await created.text()).toBe(201);
    }
    const admin = newInvitee('Dev Anand');
    const link = await inviteAs(page.request, admin, 'Manager');

    // The Manager joins from a browser of their own, and takes their own Manager role away.
    const context = await browser.newContext({ baseURL });
    const joined = await context.request.post(`${WEB_ORIGIN}/api/invitations/accept`, {
      data: { token: new URL(link).searchParams.get('token') },
      headers: { origin: WEB_ORIGIN },
    });
    expect(joined.status(), await joined.text()).toBe(200);
    const own = await context.newPage();
    await own.goto('/en/users-roles');
    await expect(own.getByRole('button', { name: 'Invite people' })).toBeVisible();

    await own.getByRole('button', { name: `Actions for ${admin.name}` }).click();
    await own.getByRole('menuitem', { name: 'Change roles' }).click();
    const dialog = own.getByRole('dialog', { name: `Change roles for ${admin.name}` });
    await dialog.getByRole('checkbox', { name: 'Viewer', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'Manager', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save roles' }).click();

    // The page re-reads the session: no invite button, no row menus.
    await expect(own.getByRole('button', { name: 'Invite people' })).toHaveCount(0);
    await expect(own.getByRole('button', { name: /^Actions for/ })).toHaveCount(0);
    await context.close();
  });

  test('the Roles tab is a link that marks itself current', async ({ page, playwright }) => {
    await ownerPage(page, playwright);
    await page.goto('/en/users-roles?tab=roles');
    await expect(page.getByRole('link', { name: 'Roles', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { level: 2, name: 'Roles' })).toBeVisible();
  });
});
