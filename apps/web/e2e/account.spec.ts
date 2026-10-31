import { expect, type Page, test } from '@playwright/test';

import { latestEmailTo } from './support/mailpit';
import { createVerifiedSchool, signInWithCode, type VerifiedSchool } from './support/school';

// Each test owns a school and its owner, so changing a password here never touches the shared
// signed-in state the other specs use.
test.use({ storageState: { cookies: [], origins: [] } });

const CODE_SUBJECT = /is your Classloom sign-in code/;

async function openAccount(page: Page, school: VerifiedSchool, remember = true) {
  await signInWithCode(page.request, school, remember);
  await page.goto('/en/account');
  await expect(page.getByRole('heading', { level: 1, name: 'My account' })).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue(school.name);
}

test('profile: saves the name, rejects a bad mobile and a taken one, then clears it', async ({
  page,
  playwright,
}) => {
  const request = await playwright.request.newContext();
  const school = await createVerifiedSchool(request);
  const other = await createVerifiedSchool(request);
  await request.dispose();

  await openAccount(page, school);
  await expect(page.getByLabel('Email')).toHaveValue(school.email);
  await expect(page.getByLabel('Email')).not.toBeEditable();
  await expect(page.getByText('Verified')).toBeVisible();
  await expect(page.getByLabel('Mobile number')).toHaveValue(school.mobile);

  // Client-side validation lands on the field.
  await page.getByLabel('Name').fill('A');
  await page.getByLabel('Mobile number').fill('12345');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter your name, 2 to 80 characters.')).toBeVisible();
  await expect(page.getByLabel('Mobile number')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Mobile number')).toHaveAccessibleDescription(
    /Enter a valid 10-digit Indian mobile number\./,
  );

  // Another account's number: the API's 409 lands on the mobile field.
  await page.getByLabel('Name').fill('Asha R Rawat');
  await page.getByLabel('Mobile number').fill(other.mobile);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByText('This mobile number is already used by another account.'),
  ).toBeVisible();
  await expect(page.getByLabel('Mobile number')).toHaveAttribute('aria-invalid', 'true');

  // Clearing the mobile saves, and the new name shows in the shell after the refresh.
  await page.getByLabel('Mobile number').fill('');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Your profile has been saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Name')).toHaveValue('Asha R Rawat');
  await expect(page.getByLabel('Mobile number')).toHaveValue('');
});

test('password: sets a first password, then changes it', async ({ page, playwright }) => {
  test.slow();
  const request = await playwright.request.newContext();
  const school = await createVerifiedSchool(request);
  await request.dispose();
  await openAccount(page, school);

  await expect(page.getByRole('heading', { level: 2, name: 'Set a password' })).toBeVisible();
  await expect(page.getByText(/You sign in with email codes\./)).toBeVisible();
  await expect(page.getByLabel('Current password')).toHaveCount(0);

  await page.getByLabel('New password', { exact: true }).fill('short');
  await page.getByLabel('Confirm new password').fill('different');
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByText("The passwords don't match.")).toBeVisible();

  // A rule only the server knows: the API's 400 lands on the new-password field.
  await page.getByLabel('New password', { exact: true }).fill('1234567890');
  await page.getByLabel('Confirm new password').fill('1234567890');
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByText(/too common/)).toBeVisible();
  await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );

  const first = 'ember lantern 42 quartz';
  await page.getByLabel('New password', { exact: true }).fill(first);
  await page.getByLabel('Confirm new password').fill(first);
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByText('Your password has been set.')).toBeVisible();
  // The toast sits over the form's bottom edge on a phone; let it go before clicking there.
  await page.mouse.move(1, 1);
  await expect(page.getByText('Your password has been set.')).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 2, name: 'Change password' })).toBeVisible();

  // Changing needs the current password.
  const second = 'copper meadow 77 violin';
  await page.getByLabel('New password', { exact: true }).fill(second);
  await page.getByLabel('Confirm new password').fill(second);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Enter your current password.')).toBeVisible();

  await page.getByLabel('Current password').fill('not the password');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Your current password is incorrect.')).toBeVisible();
  await expect(page.getByLabel('Current password')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Current password').fill(first);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText(/Your password has been changed\./)).toBeVisible();

  // This session carries on after the change.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'My account' })).toBeVisible();

  // The new password signs in (through the API, as a second device would).
  const device = await playwright.request.newContext();
  const origin = new URL(page.url()).origin;
  const signIn = await device.post(`${origin}/api/auth/sign-in/password`, {
    data: { schoolCode: school.code, identifier: school.email, password: second, remember: true },
    headers: { origin },
  });
  expect(signIn.status()).toBe(200);
  await device.dispose();
});

test('reauth: a signed-in visitor re-confirms with an emailed code and returns to the account page', async ({
  page,
  playwright,
}, testInfo) => {
  // One project is enough for the 61 s wait.
  test.skip(testInfo.project.name !== 'desktop-chrome', 'slow: runs on desktop-chrome only');
  // The API drops a second code within 60 seconds of the one that signed in.
  test.setTimeout(150_000);
  const request = await playwright.request.newContext();
  const school = await createVerifiedSchool(request);
  await request.dispose();
  // A session that was not asked to be remembered must stay that way after reauth.
  await openAccount(page, school, false);
  const signInCode = (await latestEmailTo(page.request, school.email, CODE_SUBJECT)).subject;
  await page.waitForTimeout(61_000);

  await page.goto(`/en/sign-in?school=${school.code}&next=%2Fen%2Faccount&reauth=1`);
  // Not sent to `next`: the page opens on the code step and sends the code by itself.
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  await expect(page).toHaveURL(/reauth=1/);

  // The mailbox still holds the code that signed in; wait for the new one.
  let subject = signInCode;
  await expect(async () => {
    subject = (await latestEmailTo(page.request, school.email, CODE_SUBJECT)).subject;
    expect(subject).not.toBe(signInCode);
  }).toPass();
  const code = /^(\d{6}) is your Classloom sign-in code/.exec(subject)?.[1];
  expect(code, subject).toBeDefined();
  const verify = page.waitForRequest((r) => r.url().endsWith('/api/auth/otp/verify'));
  await page.getByLabel('Sign-in code').fill(code!);
  expect((await verify).postDataJSON() as { remember: boolean }).toMatchObject({ remember: false });

  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(page.getByRole('heading', { level: 1, name: 'My account' })).toBeVisible();
});

test('reauth is ignored when signed out', async ({ page, playwright }) => {
  const request = await playwright.request.newContext();
  const school = await createVerifiedSchool(request);
  await request.dispose();

  await page.goto(`/en/sign-in?school=${school.code}&next=%2Fen%2Faccount&reauth=1`);
  await expect(page.getByText(/Signing in to/)).toBeVisible();
  await expect(page.getByLabel('Email or mobile number')).toHaveValue('');
});
