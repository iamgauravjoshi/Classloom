import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test, type TestInfo } from '@playwright/test';

import { latestEmailTo, verificationLink } from './support/mailpit';

const PAGE_URL = '/en/register-school';
const TERMS = /I accept the Terms/;
const PROJECTS = [
  'desktop-chrome',
  'desktop-firefox',
  'desktop-webkit',
  'pixel-7',
  'iphone-14',
  'ipad',
];

/** Unique per test and project: `E` + 5 time digits + the project's index (a valid 7-char code). */
function uniqueData(testInfo: TestInfo) {
  const stamp = Date.now();
  const index = Math.max(PROJECTS.indexOf(testInfo.project.name), 0);
  return {
    email: `e2e-${testInfo.project.name}-${stamp}-${testInfo.parallelIndex}@example.com`,
    code: `E${String(stamp % 1e5).padStart(5, '0')}${index}`,
  };
}

async function openForm(page: Page) {
  await page.goto(PAGE_URL);
  // An empty aria-busy placeholder is rendered until the draft is read.
  await expect(page.getByLabel('School name')).toBeVisible();
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

async function fillSchool(page: Page) {
  await page.getByLabel('School name').fill('Global International School');
  await pick(page, 'Board', 'CBSE');
  await page.getByLabel('City').fill('Dehradun');
  await pick(page, 'State or union territory', 'Uttarakhand');
  await page.getByRole('button', { name: 'Next' }).click();
}

// The suggested code is pre-filled asynchronously; replacing it earlier races with that prefill.
async function waitForSuggestion(page: Page) {
  await expect(page.getByLabel('School code')).not.toHaveValue('');
}

async function fillCode(page: Page, code: string) {
  const field = page.getByLabel('School code');
  await expect(field).toBeVisible();
  await waitForSuggestion(page);
  await field.fill(code);
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
}

async function fillAdmin(page: Page, email: string) {
  await page.getByLabel('Your full name').fill('Asha Rawat');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('checkbox', { name: TERMS }).check();
}

async function register(page: Page, email: string, code: string) {
  await openForm(page);
  await fillSchool(page);
  await fillCode(page, code);
  await fillAdmin(page, email);
  await page.getByRole('button', { name: 'Register school' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
}

async function linkFor(request: APIRequestContext, email: string) {
  return verificationLink((await latestEmailTo(request, email)).text);
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.map(
    (v) =>
      `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 160) + ' @ ' + n.target.join(' ') + ' ' + (n.any[0]?.message ?? '')).join(' | ')}`,
  );
}

/**
 * Registers a school and visits every screen once (steps 1 to 3, the sent screen, verify success,
 * verify invalid with its resend form), calling `check` on each when it has settled.
 */
async function walkAllScreens(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
  check: () => Promise<void>,
) {
  const { email, code } = uniqueData(testInfo);
  await openForm(page);
  await check();
  await fillSchool(page);
  await expect(page.getByLabel('School code')).toBeVisible();
  await check();
  await fillCode(page, code);
  await expect(page.getByLabel('Your full name')).toBeVisible();
  await fillAdmin(page, email);
  await check();
  await page.getByRole('button', { name: 'Register school' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  await check();

  const link = await linkFor(request, email);
  await page.goto(link);
  await expect(page.getByRole('heading', { name: /is ready/ })).toBeVisible();
  await check();

  await page.goto(link);
  await expect(page.getByRole('heading', { name: /no longer valid/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request a new link' })).toBeVisible();
  await check();
}

test.describe('school registration', () => {
  test('registers a school and verifies it from the emailed link', async ({
    page,
    request,
  }, testInfo) => {
    const { email, code } = uniqueData(testInfo);
    await register(page, email, code);
    await expect(page.getByText(/e\*+.*@example\.com/)).toBeVisible();

    await page.goto(await linkFor(request, email));
    await expect(page.getByRole('heading', { name: /is ready/ })).toBeVisible();
    await expect(page.getByText(code, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy code' })).toBeVisible();
    expect(page.url()).not.toContain('token=');
  });

  test('"Use a different email" frees the code for the corrected registration', async ({
    page,
    request,
  }, testInfo) => {
    const { email, code } = uniqueData(testInfo);
    await register(page, email, code);
    const mistypedLink = await linkFor(request, email);

    await page.getByRole('button', { name: 'Use a different email' }).click();
    const emailField = page.getByLabel('Email address');
    await expect(emailField).toHaveValue(email);
    const corrected = email.replace('@example.com', '.fixed@example.com');
    await emailField.fill(corrected);
    await page.getByRole('checkbox', { name: TERMS }).check();
    await page.getByRole('button', { name: 'Register school' }).click();
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

    // The link sent to the mistyped address is dead; the corrected one verifies the same code.
    await page.goto(mistypedLink);
    await expect(page.getByRole('heading', { name: /no longer valid/ })).toBeVisible();
    await page.goto(await linkFor(request, corrected));
    await expect(page.getByRole('heading', { name: /is ready/ })).toBeVisible();
    await expect(page.getByText(code, { exact: true })).toBeVisible();
  });

  test('a scriptless GET of the link does not use it up', async ({ page, request }, testInfo) => {
    const { email, code } = uniqueData(testInfo);
    await register(page, email, code);
    const link = await linkFor(request, email);

    const response = await request.get(link);
    expect(response.status()).toBe(200);

    await page.goto(link);
    await expect(page.getByRole('heading', { name: /is ready/ })).toBeVisible();
  });

  test('shows Taken for a code that is already registered', async ({ page, context }, testInfo) => {
    const { email, code } = uniqueData(testInfo);
    await register(page, email, code);

    // A fresh page: re-opening the same URL in this one would keep its history step.
    const second = await context.newPage();
    await openForm(second);
    await fillSchool(second);
    await waitForSuggestion(second);
    await second.getByLabel('School code').fill(code);
    await expect(second.getByText('Taken').first()).toBeVisible();
  });

  test('a link used twice shows no longer valid with a resend form', async ({
    page,
    request,
  }, testInfo) => {
    const { email, code } = uniqueData(testInfo);
    await register(page, email, code);
    const link = await linkFor(request, email);

    await page.goto(link);
    await expect(page.getByRole('heading', { name: /is ready/ })).toBeVisible();

    await page.goto(link);
    await expect(page.getByRole('heading', { name: /no longer valid/ })).toBeVisible();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request a new link' })).toBeVisible();
  });

  test('keeps the first steps after a reload on step 3', async ({ page }, testInfo) => {
    const { code } = uniqueData(testInfo);
    await openForm(page);
    await fillSchool(page);
    await fillCode(page, code);
    await expect(page.getByLabel('Your full name')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Your full name')).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByLabel('School code')).toHaveValue(code);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByLabel('School name')).toHaveValue('Global International School');
    await expect(page.getByLabel('City')).toHaveValue('Dehradun');
  });

  test('has no horizontal overflow on any step', async ({ page }, testInfo) => {
    const { email, code } = uniqueData(testInfo);
    await openForm(page);
    await expectNoOverflow(page);
    await fillSchool(page);
    await expect(page.getByLabel('School code')).toBeVisible();
    await expectNoOverflow(page);
    await fillCode(page, code);
    await fillAdmin(page, email);
    await expectNoOverflow(page);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`every screen has no WCAG 2.1 AA violations (${theme})`, async ({
      page,
      request,
    }, testInfo) => {
      await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
      await walkAllScreens(page, request, testInfo, async () => {
        expect(await axeViolations(page)).toEqual([]);
      });
    });
  }

  test('has no horizontal overflow at 375px on any screen', async ({ page, request }, testInfo) => {
    test.skip(
      !['desktop-chrome', 'iphone-14'].includes(testInfo.project.name),
      'a layout check, run on one desktop and one phone engine',
    );
    await page.setViewportSize({ width: 375, height: 812 });
    await walkAllScreens(page, request, testInfo, async () => {
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    });
  });

  test('completes with the keyboard only', async ({ page, request }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop-'), 'keyboard flow is for desktop');
    const { email, code } = uniqueData(testInfo);
    const { keyboard } = page;
    // Safari only tabs onto form controls other than text fields with Alt held.
    const tabKey = testInfo.project.name === 'desktop-webkit' ? 'Alt+Tab' : 'Tab';
    const tab = async (count = 1) => {
      for (let i = 0; i < count; i += 1) await keyboard.press(tabKey);
    };

    await openForm(page);
    await page.getByLabel('School name').focus();
    await keyboard.type('Global International School');
    await tab();
    await keyboard.press('Enter');
    await expect(page.getByRole('option', { name: 'CBSE' })).toBeVisible();
    await keyboard.press('Enter'); // the list opens on its first option
    await expect(page.getByRole('combobox', { name: 'Board' })).toContainText('CBSE');
    // Focus returns to the trigger once the list has closed; tabbing earlier would skip City.
    await expect(page.getByRole('combobox', { name: 'Board' })).toBeFocused();
    await tab();
    await keyboard.type('Dehradun');
    await tab();
    await keyboard.press('Enter');
    await expect(page.getByRole('option', { name: 'Uttarakhand' })).toBeVisible();
    await keyboard.type('Uttarakhand');
    await keyboard.press('Enter');
    await expect(page.getByRole('combobox', { name: 'State or union territory' })).toContainText(
      'Uttarakhand',
    );
    await expect(page.getByRole('combobox', { name: 'State or union territory' })).toBeFocused();
    await tab();
    await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
    await keyboard.press('Enter');

    const codeField = page.getByLabel('School code');
    await expect(codeField).toBeVisible();
    await waitForSuggestion(page);
    await codeField.focus();
    await keyboard.press('ControlOrMeta+A');
    await keyboard.type(code);
    await expect(page.getByText('Available', { exact: true })).toBeVisible();
    await tab(2); // Back, then Next
    await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
    await keyboard.press('Enter');

    await expect(page.getByLabel('Your full name')).toBeVisible();
    await page.getByLabel('Your full name').focus();
    await keyboard.type('Asha Rawat');
    await tab();
    await keyboard.type(email);
    await tab(2); // past the optional mobile number
    await expect(page.getByRole('checkbox', { name: TERMS })).toBeFocused();
    await keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: TERMS })).toBeChecked();
    await page.getByRole('button', { name: 'Register school' }).focus();
    await keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
    expect((await latestEmailTo(request, email)).subject).toBeTruthy();
  });
});
