import { expect, test } from '@playwright/test';

import { inviteAs, newInvitee } from './support/invitations';
import {
  createVerifiedSchool,
  signInWithCode,
  signInWithCodeKeepingRequirement,
  WEB_ORIGIN,
} from './support/school';
import { totpCode } from './support/totp';

// Each test has a school of its own and no saved sign-in: they sign people in and out.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('joining from an invitation', () => {
  test('previews, joins, welcomes, and the Teacher role sees only its pages', async ({
    page,
    playwright,
  }) => {
    const owner = await playwright.request.newContext();
    const school = await createVerifiedSchool(owner);
    await signInWithCode(owner, school);
    const invitee = newInvitee();
    const link = await inviteAs(owner, invitee);
    await owner.dispose();

    await page.goto(link);
    // The token leaves the address bar on load.
    await expect(page).toHaveURL(/\/en\/join$/);
    await expect(page.getByText('Join Global International School as Teacher.')).toBeVisible();
    await expect(page.getByText(`Invitation for ${invitee.name}`)).toBeVisible();

    await page.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Welcome to Global International School' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Set a password' })).toBeVisible();

    await page.getByRole('link', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    // The Teacher role has no fees or users-and-roles permission: a typed address says so.
    for (const path of ['/en/fees', '/en/users-roles']) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { level: 2, name: "You don't have access to this page" }),
      ).toBeVisible();
    }
    await page.goto('/en/students');
    await expect(page.getByText(/is coming soon/)).toBeVisible();
  });

  test('a spent link says it has expired', async ({ page, playwright }) => {
    const owner = await playwright.request.newContext();
    const school = await createVerifiedSchool(owner);
    await signInWithCode(owner, school);
    const link = await inviteAs(owner, newInvitee());
    await owner.dispose();

    const token = new URL(link).searchParams.get('token');
    const accepted = await page.request.post(`${WEB_ORIGIN}/api/invitations/accept`, {
      data: { token },
      headers: { origin: WEB_ORIGIN },
    });
    expect(accepted.status(), await accepted.text()).toBe(200);
    await page.context().clearCookies();

    await page.goto(link);
    await expect(
      page.getByRole('heading', { level: 1, name: 'This link has expired or was already used' }),
    ).toBeVisible();
  });

  test('offers "Sign out and join" to someone signed in as another person', async ({
    page,
    playwright,
  }) => {
    const request = await playwright.request.newContext();
    const school = await createVerifiedSchool(request);
    await request.dispose();
    // This browser is signed in as the school's owner, who invites someone else.
    await signInWithCode(page.request, school);
    const link = await inviteAs(page.request, newInvitee());
    await page.goto(link);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: /^This invitation is for .\*\*\*@example\.com$/,
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Sign out and join' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Welcome to Global International School' }),
    ).toBeVisible();
  });
});

test.describe('required two-step setup', () => {
  test('sends a new owner to the setup page and on to the page asked for', async ({
    page,
    playwright,
  }) => {
    const request = await playwright.request.newContext();
    const school = await createVerifiedSchool(request);
    await request.dispose();
    await signInWithCodeKeepingRequirement(page.request, school);

    await page.goto('/en/students');
    await expect(page).toHaveURL(/\/en\/setup-two-factor\?next=%2Fen%2Fstudents$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Set up two-step sign-in' }),
    ).toBeVisible();
    await expect(
      page.getByText('Your school requires two-step sign-in for your role.'),
    ).toBeVisible();
    // No app shell, and no way to skip or switch the requirement off.
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /skip|turn off/i })).toHaveCount(0);

    await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
    const key = (await page.getByText(/^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/).innerText()).replace(
      /\s/g,
      '',
    );
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Authenticator code').fill(totpCode(key));
    await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
    await page.getByRole('checkbox', { name: "I've saved these codes" }).check();
    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page).toHaveURL(/\/en\/students$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Students' })).toBeVisible();
  });

  test('a finished setup page just carries on', async ({ page, playwright }) => {
    const request = await playwright.request.newContext();
    const school = await createVerifiedSchool(request);
    await request.dispose();
    await signInWithCode(page.request, school);

    await page.goto('/en/setup-two-factor?next=%2Fen%2Fstudents');
    await expect(page).toHaveURL(/\/en\/students$/);
  });
});
