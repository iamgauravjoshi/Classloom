import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

import { createVerifiedSchool, type VerifiedSchool } from './support/school';

const PAGES = ['/en/dashboard', '/en/students', '/en/register-school', '/en/definitely-missing'];

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
        await expectNoViolations(page);
      });
    }

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
