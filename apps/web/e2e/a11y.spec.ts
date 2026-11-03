import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

import { inviteAs, newInvitee } from './support/invitations';
import { solidPng } from './support/png';
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
  // Dialogs fade in; contrast measured mid-fade blends text with the page behind it (seen on WebKit).
  // Two frames first, so a transition started by the last tap or focus is already listed.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
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

    test.describe('users and roles', () => {
      // The page lists the school's people, so it gets a school of its own with one invitation.
      test.use({ storageState: { cookies: [], origins: [] } });

      test('/en/users-roles has no WCAG 2.1 AA violations, list and invite dialog', async ({
        page,
        playwright,
      }) => {
        const request = await playwright.request.newContext();
        const own = await createVerifiedSchool(request);
        await request.dispose();
        // The owner is relaxed (no required two-step), so the session reaches the page.
        await signInWithCode(page.request, own);
        const invitee = newInvitee('Ravi Kumar');
        await inviteAs(page.request, invitee);

        await page.goto('/en/users-roles');
        await expect(page.getByRole('heading', { level: 1, name: 'Users & roles' })).toBeVisible();
        const tabs = page.getByRole('navigation', { name: 'Users and roles sections' });
        await expect(tabs.getByRole('link', { name: 'Members' })).toHaveAttribute(
          'aria-current',
          'page',
        );
        await expect(page.getByText(invitee.email).filter({ visible: true }).first()).toBeVisible();
        await expect(page.getByText(own.email).filter({ visible: true }).first()).toBeVisible();
        await expectNoViolations(page);

        await page.getByRole('button', { name: 'Invite people' }).click();
        const dialog = page.getByRole('dialog', { name: 'Invite people' });
        await expect(dialog.getByLabel('Email')).toBeFocused();
        await expect(dialog.getByRole('checkbox', { name: 'Teacher', exact: true })).toBeVisible();
        await expectNoViolations(page);
      });

      test('/en/users-roles roles tab and role editor have no WCAG 2.1 AA violations', async ({
        page,
        playwright,
      }) => {
        const request = await playwright.request.newContext();
        const own = await createVerifiedSchool(request);
        await request.dispose();
        await signInWithCode(page.request, own);

        await page.goto('/en/users-roles?tab=roles');
        await expect(
          page.getByRole('heading', { level: 3, name: 'Teacher', exact: true }),
        ).toBeVisible();
        await expectNoViolations(page);

        await page.goto('/en/users-roles/roles/new');
        await expect(page.getByRole('heading', { level: 1, name: 'Create role' })).toBeVisible();
        await expect(page.getByRole('checkbox', { name: 'Students: View' })).toBeVisible();
        await expectNoViolations(page);

        // A ticked grid, a disabled (read-only) one, and the tooltip on a cell that is not theirs.
        await page.getByRole('button', { name: 'Manager', exact: true }).click();
        await expectNoViolations(page);
        await page.goto('/en/users-roles?tab=roles');
        await page.getByRole('link', { name: 'Edit Owner' }).click();
        await expect(page.getByRole('switch', { name: 'Require two-step sign-in' })).toBeVisible();
        await expectNoViolations(page);
      });
    });

    test.describe('school profile settings', () => {
      // The page edits the school, so it gets a school of its own.
      test.use({ storageState: { cookies: [], origins: [] } });

      test('/en/settings/school-profile has no WCAG 2.1 AA violations, without and with a logo', async ({
        page,
        playwright,
      }) => {
        const request = await playwright.request.newContext();
        const own = await createVerifiedSchool(request);
        await request.dispose();
        await signInWithCode(page.request, own);

        // No logo yet: the empty preview and the Upload button.
        await page.goto('/en/settings/school-profile');
        await expect(page.getByRole('heading', { level: 1, name: 'School profile' })).toBeVisible();
        await expect(page.getByText('No logo yet')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Upload logo' })).toBeVisible();
        await expect(page.getByLabel('School name')).toHaveValue(own.schoolName);
        await expectNoViolations(page);

        // A refused file shows its message beside the field.
        await page.getByLabel('Choose a logo image').setInputFiles({
          name: 'logo.gif',
          mimeType: 'image/gif',
          buffer: Buffer.from('GIF89a'),
        });
        await expect(page.getByText('Upload a PNG, JPEG or WebP image.')).toBeVisible();
        // Field errors after a save with invalid values.
        await page.getByLabel('UDISE+ code').fill('123');
        await page.getByLabel('PIN code').fill('012345');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByText('Enter the 11-digit UDISE+ code.')).toBeVisible();
        await expect(page.getByText('Enter a 6-digit PIN code.')).toBeVisible();
        await expectNoViolations(page);

        // With a logo: the preview, Replace and Remove, and the logo in the sidebar.
        const uploaded = await page.request.put(`${WEB_ORIGIN}/api/school/logo`, {
          multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: solidPng() } },
          headers: { origin: WEB_ORIGIN },
        });
        expect(uploaded.status(), await uploaded.text()).toBe(200);
        await page.goto('/en/settings/school-profile');
        await expect(page.getByRole('img', { name: 'School logo' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Replace' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
        await expectNoViolations(page);
      });
    });

    test.describe('academic years and campuses settings', () => {
      // The pages change the school's years and campuses, so each test gets a school of its own.
      test.use({ storageState: { cookies: [], origins: [] } });

      /** A write through the web app's `/api` proxy, as the signed-in page would send it. */
      const send = async (page: Page, path: string, data: unknown, status: number) => {
        const response = await page.request.post(`${WEB_ORIGIN}/api${path}`, {
          data,
          headers: { origin: WEB_ORIGIN },
        });
        expect(response.status(), await response.text()).toBe(status);
        return (await response.json().catch(() => ({}))) as { id: string };
      };

      test('/en/settings/academic-years has no WCAG 2.1 AA violations, empty, listed and in the form', async ({
        page,
        playwright,
      }) => {
        const request = await playwright.request.newContext();
        const own = await createVerifiedSchool(request);
        await request.dispose();
        await signInWithCode(page.request, own);

        // No years yet: the empty state and "Set up academic year".
        await page.goto('/en/settings/academic-years');
        await expect(page.getByRole('heading', { level: 1, name: 'Academic years' })).toBeVisible();
        await expect(page.getByText('No academic year yet')).toBeVisible();
        await expectNoViolations(page);

        // The form dialog, with its terms and a tiling problem on a row.
        await page.getByRole('button', { name: 'Set up academic year' }).click();
        const dialog = page.getByRole('dialog', { name: 'Set up academic year' });
        await expect(dialog.getByLabel('Term 2 ends on')).toBeVisible();
        await dialog.getByRole('radio', { name: '3 terms' }).check();
        await expect(dialog.getByLabel('Term 3 ends on')).toBeVisible();
        await dialog.getByLabel('Term 2 starts on').fill('05/08/2026');
        await dialog.getByRole('button', { name: 'Create year' }).click();
        await expect(
          dialog.getByText('This term must start the day after the previous term ends.'),
        ).toBeVisible();
        await expectNoViolations(page);
        await page.keyboard.press('Escape');

        // A current and a planned year, and the make-current question with its early-start wording.
        await send(
          page,
          '/school/academic-years',
          { startsOn: '2026-04-01', endsOn: '2027-03-31', termCount: 2 },
          201,
        );
        await send(
          page,
          '/school/academic-years',
          { startsOn: '2027-04-01', endsOn: '2028-03-31', termCount: 3 },
          201,
        );
        await page.goto('/en/settings/academic-years');
        await expect(page.getByRole('heading', { level: 2, name: '2026–27' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: '2027–28' })).toBeVisible();
        await expect(page.getByText('Planned', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Prepare next year' })).toHaveCount(0);
        await expectNoViolations(page);

        await page.getByRole('button', { name: 'Make current: 2027–28' }).click();
        const question = page.getByRole('dialog', { name: 'Make 2027–28 the current year?' });
        await expect(
          question.getByText('2027–28 starts on 01/04/2027.', { exact: false }),
        ).toBeVisible();
        await expectNoViolations(page);
      });

      test('/en/settings/campuses has no WCAG 2.1 AA violations, one and two campuses and the edit dialog', async ({
        page,
        playwright,
      }) => {
        const request = await playwright.request.newContext();
        const own = await createVerifiedSchool(request);
        await request.dispose();
        await signInWithCode(page.request, own);

        // The campus the school was registered with.
        await page.goto('/en/settings/campuses');
        await expect(page.getByRole('heading', { level: 1, name: 'Campuses' })).toBeVisible();
        await expect(page.getByText('Primary', { exact: true })).toBeVisible();
        await expectNoViolations(page);

        // A second campus, deactivated.
        const added = await send(
          page,
          '/school/campuses',
          { name: 'North Campus', addressLine1: '12 Rajpur Road', pinCode: '248001' },
          201,
        );
        await send(page, `/school/campuses/${added.id}/deactivate`, {}, 200);
        await page.goto('/en/settings/campuses');
        await expect(page.getByRole('heading', { level: 2, name: 'North Campus' })).toBeVisible();
        await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Reactivate North Campus' })).toBeVisible();
        await expectNoViolations(page);

        // The edit dialog, with a field error.
        await page.getByRole('button', { name: 'Edit North Campus' }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit North Campus' });
        await expect(dialog.getByLabel('Campus name')).toHaveValue('North Campus');
        await dialog.getByLabel('PIN code').fill('012345');
        await dialog.getByRole('button', { name: 'Save changes' }).click();
        await expect(dialog.getByText('Enter a 6-digit PIN code.')).toBeVisible();
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
