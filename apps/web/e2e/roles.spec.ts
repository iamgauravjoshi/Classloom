import { expect, type Page, type PlaywrightWorkerArgs, test } from '@playwright/test';

import { inviteAs, newInvitee } from './support/invitations';
import { createVerifiedSchool, signInWithCode, WEB_ORIGIN } from './support/school';

// Each test has a school of its own and no saved sign-in: they change roles.
test.use({ storageState: { cookies: [], origins: [] } });

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function ownerPage(page: Page, playwright: PlaywrightWorkerArgs['playwright']) {
  const request = await playwright.request.newContext();
  const school = await createVerifiedSchool(request);
  await request.dispose();
  await signInWithCode(page.request, school);
  return school;
}

const card = (page: Page, name: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) });

test.describe('roles', () => {
  test('creates, clones, edits and deletes a custom role with the grid', async ({
    page,
    playwright,
  }) => {
    await ownerPage(page, playwright);
    await page.goto('/en/users-roles?tab=roles');
    await expect(page.getByRole('heading', { level: 3, name: 'Owner', exact: true })).toBeVisible();
    await expect(card(page, 'Owner').getByText('Built-in')).toBeVisible();
    await expect(card(page, 'Teacher').getByText(/13 of \d+ permissions/)).toBeVisible();

    await page.getByRole('link', { name: 'Create role' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Create role' })).toBeVisible();

    // A name is needed.
    await page.getByRole('button', { name: 'Create role', exact: true }).click();
    await expect(page.getByText('Enter a name, 2 to 40 characters.')).toBeVisible();

    await page.getByLabel('Name', { exact: true }).fill('Front desk');
    await page.getByLabel('Description').fill('Greets visitors.');
    // Manage brings view with it.
    await page.getByRole('checkbox', { name: 'Classes & sections: Manage' }).click();
    await expect(page.getByRole('checkbox', { name: 'Classes & sections: View' })).toBeChecked();
    await expect(page.getByText('2 of 2').filter({ visible: true }).first()).toBeVisible();
    // Select all, per module.
    await page.getByRole('checkbox', { name: 'Select all Students' }).click();
    await expect(page.getByRole('checkbox', { name: 'Students: Export' })).toBeChecked();
    await expect(page.getByText('5 of 5').filter({ visible: true }).first()).toBeVisible();
    await page.getByRole('checkbox', { name: 'Students: Delete' }).click();
    await expect(page.getByText('4 of 5').filter({ visible: true }).first()).toBeVisible();
    // A preset replaces the ticks.
    await page.getByRole('button', { name: 'Read only' }).click();
    await expect(page.getByRole('checkbox', { name: 'Students: Create' })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Students: View' })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Fees: Approve' }).click();
    await page.getByRole('switch', { name: 'Require two-step sign-in' }).click();
    await page.getByRole('button', { name: 'Create role', exact: true }).click();

    await expect(page.getByText('Front desk was created.')).toBeVisible();
    await expect(page).toHaveURL(/\/en\/users-roles\?tab=roles/);
    await expect(card(page, 'Front desk').getByText('Custom')).toBeVisible();
    await expect(card(page, 'Front desk').getByText('Requires two-step')).toBeVisible();
    await expect(card(page, 'Front desk').getByText(/0 members/)).toBeVisible();

    // A second role with the same name is refused on the name.
    await page.getByRole('link', { name: 'Create role' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Front desk');
    await page.getByRole('button', { name: 'Create role', exact: true }).click();
    await expect(page.getByText('A role with this name already exists.')).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toBeFocused();

    // Clone: pre-filled from the role.
    await page.goto('/en/users-roles?tab=roles');
    await page.getByRole('link', { name: 'Clone Front desk' }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Front desk copy');
    await expect(page.getByLabel('Description')).toHaveValue('Greets visitors.');
    await expect(page.getByRole('checkbox', { name: 'Fees: Approve' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Require two-step sign-in' })).toBeChecked();
    await page.getByLabel('Name', { exact: true }).fill('Front desk night');
    await page.getByRole('button', { name: 'Create role', exact: true }).click();
    await expect(card(page, 'Front desk night')).toBeVisible();

    // Edit.
    await page.getByRole('link', { name: 'Edit Front desk night' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Edit role' })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Night desk');
    await page.getByRole('checkbox', { name: 'Fees: Approve' }).click();
    await page.getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByText('Night desk was saved.')).toBeVisible();
    await expect(card(page, 'Night desk')).toBeVisible();

    // Delete, from the list: cancel first, then confirm.
    await page.getByRole('button', { name: 'Delete Night desk' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete Night desk?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Delete Night desk' })).toBeFocused();
    await page.getByRole('button', { name: 'Delete Night desk' }).click();
    await dialog.getByRole('button', { name: 'Delete role' }).click();
    await expect(page.getByText('Night desk was deleted.')).toBeVisible();
    await expect(card(page, 'Night desk')).toHaveCount(0);
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test('resets a built-in role to default, and refuses to delete one that is assigned', async ({
    page,
    playwright,
  }) => {
    await ownerPage(page, playwright);
    await page.goto('/en/users-roles?tab=roles');
    await page.getByRole('link', { name: 'Edit Teacher' }).click();
    // A built-in role keeps its name.
    await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('readonly', '');
    await page.getByRole('checkbox', { name: 'Fees: View' }).click();
    await page.getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByText('Teacher was saved.')).toBeVisible();
    await expect(card(page, 'Teacher').getByText(/14 of \d+ permissions/)).toBeVisible();

    await page.getByRole('button', { name: 'Reset to default: Teacher' }).click();
    const reset = page.getByRole('dialog', { name: 'Reset Teacher to default?' });
    await reset.getByRole('button', { name: 'Reset to default' }).click();
    await expect(page.getByText('Teacher was reset to default.')).toBeVisible();
    await expect(card(page, 'Teacher').getByText(/13 of \d+ permissions/)).toBeVisible();

    // A custom role somebody holds cannot be deleted.
    const created = await page.request.post(`${WEB_ORIGIN}/api/iam/roles`, {
      data: { name: 'Helper', permissions: ['dashboard.view'], requiresTwoFactor: false },
      headers: { origin: WEB_ORIGIN },
    });
    expect(created.status(), await created.text()).toBe(201);
    const link = await inviteAs(page.request, newInvitee('Asha Rao'), 'Helper');
    const joiner = await playwright.request.newContext();
    const joined = await joiner.post(`${WEB_ORIGIN}/api/invitations/accept`, {
      data: { token: new URL(link).searchParams.get('token') },
      headers: { origin: WEB_ORIGIN },
    });
    expect(joined.status(), await joined.text()).toBe(200);
    await joiner.dispose();

    await page.goto('/en/users-roles?tab=roles');
    await page.getByRole('button', { name: 'Delete Helper' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete Helper?' });
    await dialog.getByRole('button', { name: 'Delete role' }).click();
    await expect(dialog.getByText(/still assigned/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // From the editor page too: the refusal stays in the dialog, and the form is not reloaded.
    await page.getByRole('link', { name: 'Edit Helper' }).click();
    await page.getByLabel('Description').fill('Unsaved note');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await dialog.getByRole('button', { name: 'Delete role' }).click();
    await expect(dialog.getByText(/still assigned/)).toBeVisible();
    await expect(page.getByLabel('Description')).toHaveValue('Unsaved note');
  });

  test('Owner is read-only but for the two-step switch, which only an owner has', async ({
    page,
    playwright,
  }) => {
    await ownerPage(page, playwright);
    await page.goto('/en/users-roles?tab=roles');
    await page.getByRole('link', { name: 'Edit Owner' }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('readonly', '');
    await expect(page.getByRole('checkbox', { name: 'Students: Delete' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(page.getByRole('checkbox', { name: 'Students: Delete' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Read only' })).toHaveCount(0);
    const twoStep = page.getByRole('switch', { name: 'Require two-step sign-in' });
    await expect(twoStep).toBeEnabled();
    // The test school's owner has the requirement off; an owner can turn it on.
    await expect(twoStep).not.toBeChecked();
    await twoStep.click();
    await expect(twoStep).toBeChecked();
  });

  test('a viewer without iam.manage can look but not change, and cannot grant what they lack', async ({
    page,
    browser,
    baseURL,
    playwright,
  }) => {
    await ownerPage(page, playwright);
    // A manager who holds only part of the catalogue.
    const made = await page.request.post(`${WEB_ORIGIN}/api/iam/roles`, {
      data: {
        name: 'Partial manager',
        permissions: ['dashboard.view', 'iam.view', 'iam.manage', 'students.view'],
        requiresTwoFactor: false,
      },
      headers: { origin: WEB_ORIGIN },
    });
    expect(made.status(), await made.text()).toBe(201);
    const person = newInvitee('Dev Anand');
    const link = await inviteAs(page.request, person, 'Partial manager');
    const context = await browser.newContext({ baseURL });
    const joined = await context.request.post(`${WEB_ORIGIN}/api/invitations/accept`, {
      data: { token: new URL(link).searchParams.get('token') },
      headers: { origin: WEB_ORIGIN },
    });
    expect(joined.status(), await joined.text()).toBe(200);
    const own = await context.newPage();

    await own.goto('/en/users-roles/roles/new');
    const students = own.getByRole('checkbox', { name: 'Students: Edit' });
    await expect(students).toHaveAttribute('aria-disabled', 'true');
    // Reachable by keyboard, and says why.
    await own.getByRole('checkbox', { name: 'Students: View' }).focus();
    await own.keyboard.press('Tab');
    await own.keyboard.press('Tab');
    await expect(students).toBeFocused();
    await expect(own.locator('[data-slot="tooltip-content"][data-open]')).toHaveText(
      "You can't grant a permission you don't have.",
    );
    await students.press('Space');
    await expect(students).not.toBeChecked();
    // Full access gives only what they hold.
    await own.getByRole('button', { name: 'Full access' }).click();
    await expect(own.getByRole('checkbox', { name: 'Students: View' })).toBeChecked();
    await expect(own.getByRole('checkbox', { name: 'Students: Create' })).not.toBeChecked();
    await expect(own.getByRole('checkbox', { name: 'Fees: View' })).not.toBeChecked();
    await context.close();
  });

  test('works by keyboard alone', async ({ page, playwright }) => {
    await ownerPage(page, playwright);
    await page.goto('/en/users-roles/roles/new');
    await page.getByLabel('Name', { exact: true }).fill('Keyboard role');
    const box = page.getByRole('checkbox', { name: 'Attendance: View' });
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('checkbox', { name: 'Attendance: Create' })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: 'Attendance: Create' })).toBeChecked();
    await expect(page.getByText('2 of 4').filter({ visible: true }).first()).toBeVisible();
  });
});

test('the grid fits a 375 px screen as cards', async ({ page, playwright }) => {
  await ownerPage(page, playwright);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/en/users-roles/roles/new');
  await expect(page.getByRole('group', { name: 'Students' })).toBeVisible();
  await expect(page.getByRole('table')).toBeHidden();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.getByRole('checkbox', { name: 'Students: Edit' }).click();
  await expect(page.getByRole('group', { name: 'Students' }).getByText('1 of 5')).toBeVisible();
  await page.goto('/en/users-roles?tab=roles');
  await expect(page.getByRole('heading', { level: 3, name: 'Owner', exact: true })).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});
