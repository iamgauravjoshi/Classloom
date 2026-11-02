import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

import { inviteAs, newInvitee } from './support/invitations';
import {
  createVerifiedSchool,
  signInWithCode,
  signInWithCodeKeepingRequirement,
  type VerifiedSchool,
  WEB_ORIGIN,
} from './support/school';
import { enableTwoFactorFor } from './support/totp';

const PAGES = [
  '/en/dashboard',
  '/en/account',
  '/en/students',
  '/en/register-school',
  '/en/definitely-missing',
];

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 160)).join(' | ')}`,
  );
  expect(summary).toEqual([]);
}

// A well-formed token that matches no link: the form shows, and nothing is spent by opening it.
const UNUSED_TOKEN = 'A'.repeat(43);

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
    });

    for (const path of PAGES) {
      test(`${path} has no WCAG 2.1 AA violations`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        if (path === '/en/dashboard') await expect(page.getByText('API online')).toBeVisible();
        // The sections draw once `GET /me` has answered.
        if (path === '/en/account') {
          await expect(page.getByRole('heading', { level: 2, name: 'Profile' })).toBeVisible();
          await expect(
            page.getByRole('heading', { level: 2, name: 'Set a password' }),
          ).toBeVisible();
        }
        await expectNoViolations(page);
      });
    }

    test.describe('security page', () => {
      // The page lists sessions and devices, so it gets a user of its own: the shared one may have
      // been given trusted devices or other sessions by another test.
      test.use({ storageState: { cookies: [], origins: [] } });

      test('/en/account/security has no WCAG 2.1 AA violations', async ({ page, playwright }) => {
        const request = await playwright.request.newContext();
        const own = await createVerifiedSchool(request);
        await request.dispose();
        await signInWithCode(page.request, own);

        await page.goto('/en/account/security');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        // Every section has loaded its list.
        await expect(page.getByRole('button', { name: 'Turn on', exact: true })).toBeVisible();
        await expect(page.getByText('This device').first()).toBeVisible();
        await expect(page.getByText('No trusted devices')).toBeVisible();
        await expect(page.getByText('Signed in with an email code').first()).toBeAttached();
        await expectNoViolations(page);
      });
    });

    test.describe('signed out', () => {
      // The auth pages send a signed-in visitor to the dashboard.
      test.use({ storageState: { cookies: [], origins: [] } });

      let school: VerifiedSchool;
      test.beforeAll(async ({ playwright }) => {
        const request = await playwright.request.newContext();
        school = await createVerifiedSchool(request);
        await request.dispose();
      });

      test('sign-in, school step, has no WCAG 2.1 AA violations', async ({ page }) => {
        await page.goto('/en/sign-in');
        await expect(page.getByLabel('School code')).toBeVisible();
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByText('Enter your school code.')).toBeVisible();
        await expectNoViolations(page);
      });

      test('sign-in, credentials step, has no WCAG 2.1 AA violations', async ({ page }) => {
        await page.goto(`/en/sign-in?school=${school.code}`);
        await expect(page.getByText(/Signing in to/)).toBeVisible();
        await page.getByLabel('Email or mobile number').fill(school.mobile);
        await expect(page.getByText(/Sign-in codes are sent by email/)).toBeVisible();
        await expectNoViolations(page);
      });

      test('sign-in, code step, has no WCAG 2.1 AA violations', async ({ page }) => {
        await page.goto(`/en/sign-in?school=${school.code}`);
        await page.getByLabel('Email or mobile number').fill(school.email);
        await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Check your email' }),
        ).toBeVisible();
        await expect(page.getByText(/Code expires in/)).toBeVisible();
        await expectNoViolations(page);
      });

      test('sign-in, two-step step, has no WCAG 2.1 AA violations', async ({
        page,
        playwright,
      }) => {
        // A school of its own with two-step on, set up from a browser-less context.
        const password = 'ember lantern 42 quartz';
        const request = await playwright.request.newContext();
        const own = await createVerifiedSchool(request);
        await enableTwoFactorFor(request, own, password);
        await request.dispose();

        await page.goto(`/en/sign-in?school=${own.code}`);
        await page.getByLabel('Email or mobile number').fill(own.email);
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Two-step sign-in' }),
        ).toBeVisible();
        await expectNoViolations(page);

        await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
        await expect(page.getByLabel('Recovery code')).toBeVisible();
        await expectNoViolations(page);
      });

      test('security, two-step setup dialog, has no WCAG 2.1 AA violations', async ({
        page,
        playwright,
      }) => {
        // A fresh sign-in: turning two-step on needs one from the last 10 minutes.
        const request = await playwright.request.newContext();
        const own = await createVerifiedSchool(request);
        await request.dispose();
        await signInWithCode(page.request, own);

        await page.goto('/en/account/security');
        await expect(page.getByRole('heading', { level: 1, name: 'My account' })).toBeVisible();
        const tabs = page.getByRole('navigation', { name: 'Account settings' });
        await expect(tabs.getByRole('link', { name: 'Security' })).toHaveAttribute(
          'aria-current',
          'page',
        );
        await page.getByRole('button', { name: 'Turn on' }).click();
        const dialog = page.getByRole('dialog', { name: 'Turn on two-step sign-in' });
        await expect(dialog.getByRole('img', { name: /QR code/ })).toBeVisible();
        await expect(dialog.getByText(/^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/)).toBeVisible();
        await expectNoViolations(page);

        await dialog.getByRole('button', { name: 'Next' }).click();
        await expect(dialog.getByLabel('Authenticator code')).toBeFocused();
        await expectNoViolations(page);
      });

      test('join, the invitation, has no WCAG 2.1 AA violations', async ({ page, playwright }) => {
        const owner = await playwright.request.newContext();
        const own = await createVerifiedSchool(owner);
        await signInWithCode(owner, own);
        const link = await inviteAs(owner, newInvitee());
        await owner.dispose();

        await page.goto(link);
        await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
        await expect(page).toHaveURL(/\/en\/join$/);
        await expectNoViolations(page);
      });

      test('join, a spent link, has no WCAG 2.1 AA violations', async ({ page }) => {
        await page.goto(`/en/join?token=${UNUSED_TOKEN}`);
        await expect(
          page.getByRole('heading', {
            level: 1,
            name: 'This link has expired or was already used',
          }),
        ).toBeVisible();
        await expectNoViolations(page);
      });

      test('setup-two-factor has no WCAG 2.1 AA violations', async ({ page, playwright }) => {
        const request = await playwright.request.newContext();
        const own = await createVerifiedSchool(request);
        await request.dispose();
        await signInWithCodeKeepingRequirement(page.request, own);

        await page.goto('/en/dashboard');
        await expect(page).toHaveURL(/\/en\/setup-two-factor/);
        await expect(
          page.getByRole('heading', { level: 1, name: 'Set up two-step sign-in' }),
        ).toBeVisible();
        await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
        await expectNoViolations(page);

        await page.getByRole('button', { name: 'Next' }).click();
        await expect(page.getByLabel('Authenticator code')).toBeFocused();
        await expectNoViolations(page);
      });

      test('the access-denied page has no WCAG 2.1 AA violations', async ({ page, playwright }) => {
        const owner = await playwright.request.newContext();
        const own = await createVerifiedSchool(owner);
        await signInWithCode(owner, own);
        const link = await inviteAs(owner, newInvitee());
        await owner.dispose();
        // A Teacher has no fees permission.
        const accepted = await page.request.post(`${WEB_ORIGIN}/api/invitations/accept`, {
          data: { token: new URL(link).searchParams.get('token') },
          headers: { origin: WEB_ORIGIN },
        });
        expect(accepted.status(), await accepted.text()).toBe(200);

        await page.goto('/en/fees');
        await expect(
          page.getByRole('heading', { level: 2, name: "You don't have access to this page" }),
        ).toBeVisible();
        await expectNoViolations(page);
      });

      test('forgot-password has no WCAG 2.1 AA violations', async ({ page }) => {
        await page.goto('/en/forgot-password');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoViolations(page);
      });

      test('reset-password form has no WCAG 2.1 AA violations', async ({ page }) => {
        await page.goto(`/en/reset-password?token=${UNUSED_TOKEN}`);
        await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
        // The token leaves the address bar on load.
        await expect(page).toHaveURL(/\/en\/reset-password$/);
        await expectNoViolations(page);
      });

      test('reset-password after a spent link (410) has no WCAG 2.1 AA violations', async ({
        page,
      }) => {
        await page.goto(`/en/reset-password?token=${UNUSED_TOKEN}`);
        // Hydrated once the token has left the address bar; text typed earlier is lost in WebKit.
        await expect(page).toHaveURL(/\/en\/reset-password$/);
        const password = 'ember lantern 42 quartz';
        await page.getByLabel('New password', { exact: true }).fill(password);
        await page.getByLabel('Confirm password').fill(password);
        await page.getByRole('button', { name: 'Change password' }).click();
        await expect(
          page.getByRole('heading', {
            level: 1,
            name: 'This link has expired or was already used',
          }),
        ).toBeVisible();
        await expectNoViolations(page);
      });

      test('reset-password without a link has no WCAG 2.1 AA violations', async ({ page }) => {
        await page.goto('/en/reset-password');
        await expect(
          page.getByRole('heading', {
            level: 1,
            name: 'This link has expired or was already used',
          }),
        ).toBeVisible();
        await expectNoViolations(page);
      });
    });
  });
}
