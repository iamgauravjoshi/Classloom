import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type PlaywrightWorkerArgs, test } from '@playwright/test';

import { inviteAs, newInvitee } from './support/invitations';
import { solidPng } from './support/png';
import {
  createVerifiedSchool,
  currentAcademicYear,
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

    test.describe('classes page: streams, houses and rooms', () => {
      // The tabs change the school's streams, houses and rooms, so each test gets a school.
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

      const ownSchool = async (page: Page, playwright: PlaywrightWorkerArgs['playwright']) => {
        const request = await playwright.request.newContext();
        const own = await createVerifiedSchool(request);
        await request.dispose();
        await signInWithCode(page.request, own);
        return own;
      };

      const tabs = (page: Page) =>
        page.getByRole('navigation', { name: 'Classes and sections views' });

      test('/en/classes?tab=streams has no WCAG 2.1 AA violations, empty, listed and in dialogs', async ({
        page,
        playwright,
      }) => {
        await ownSchool(page, playwright);

        // No streams yet: the empty state with the starter-streams helper.
        await page.goto('/en/classes?tab=streams');
        await expect(
          page.getByRole('heading', { level: 1, name: 'Classes & sections' }),
        ).toBeVisible();
        await expect(tabs(page).getByRole('link', { name: 'Streams' })).toHaveAttribute(
          'aria-current',
          'page',
        );
        await expect(page.getByText('No streams yet')).toBeVisible();
        const helper = page.getByRole('button', { name: 'Add Science, Commerce and Humanities' });
        await expect(helper).toBeVisible();
        await expectNoViolations(page);

        // The helper adds the three; one is then archived.
        await helper.click();
        for (const name of ['Science', 'Commerce', 'Humanities']) {
          await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();
        }
        await expect(helper).toHaveCount(0);
        await page.getByRole('button', { name: 'Archive Commerce' }).click();
        const archive = page.getByRole('dialog', { name: 'Archive Commerce?' });
        await expect(archive).toBeVisible();
        await expectNoViolations(page);
        await archive.getByRole('button', { name: 'Archive', exact: true }).click();
        await expect(archive).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Restore Commerce' })).toBeVisible();
        await expect(page.getByText('Archived', { exact: true })).toBeVisible();
        await expectNoViolations(page);

        // The add dialog, refused for a name already used.
        await page.getByRole('button', { name: 'Add stream' }).click();
        const dialog = page.getByRole('dialog', { name: 'Add stream' });
        await expect(dialog.getByLabel('Stream name')).toBeFocused();
        await dialog.getByLabel('Stream name').fill('science');
        await dialog.getByRole('button', { name: 'Add stream' }).click();
        await expect(dialog.getByText('Another one already has this name.')).toBeVisible();
        // The pointer still rests on the submit button; its hover shade is not what is measured.
        await page.mouse.move(0, 0);
        await expectNoViolations(page);
      });

      test('/en/classes?tab=houses has no WCAG 2.1 AA violations, with every colour swatch', async ({
        page,
        playwright,
      }) => {
        await ownSchool(page, playwright);
        const colours = [
          'RED',
          'BLUE',
          'GREEN',
          'YELLOW',
          'ORANGE',
          'PURPLE',
          'PINK',
          'TEAL',
          'BROWN',
          'GREY',
        ];

        await page.goto('/en/classes?tab=houses');
        await expect(page.getByText('No houses yet')).toBeVisible();
        await expectNoViolations(page);

        let archivedId = '';
        for (const colour of colours) {
          const name = `${colour[0]}${colour.slice(1).toLowerCase()} House`;
          const house = await send(page, '/academics/houses', { name, colour }, 201);
          if (colour === 'GREY') archivedId = house.id;
        }
        await send(page, `/academics/houses/${archivedId}/archive`, {}, 200);
        await page.goto('/en/classes?tab=houses');
        await expect(page.getByRole('heading', { level: 3, name: 'Teal House' })).toBeVisible();
        // The colour is named in words, never shown by the swatch alone.
        await expect(page.getByText('Brown', { exact: true })).toBeVisible();
        await expect(page.getByText('Archived', { exact: true })).toBeVisible();
        await expectNoViolations(page);

        await page.getByRole('button', { name: 'Edit Red House' }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit Red House' });
        await expect(dialog.getByLabel('House name')).toHaveValue('Red House');
        await dialog.getByLabel('House name').fill('R');
        await dialog.getByRole('button', { name: 'Save changes' }).click();
        await expect(dialog.getByText('Enter a name of 2 to 40 characters.')).toBeVisible();
        // The pointer still rests on the submit button; its hover shade is not what is measured.
        await page.mouse.move(0, 0);
        await expectNoViolations(page);
      });

      test('/en/classes?tab=rooms has no WCAG 2.1 AA violations, filtered by the campus', async ({
        page,
        playwright,
      }) => {
        await ownSchool(page, playwright);
        const listed = await page.request.get(`${WEB_ORIGIN}/api/school/campuses`);
        const { campuses } = (await listed.json()) as {
          campuses: { id: string; isPrimary: boolean }[];
        };
        const primary = campuses.find((campus) => campus.isPrimary)!;
        const north = await send(page, '/school/campuses', { name: 'North Campus' }, 201);

        await page.goto('/en/classes?tab=rooms');
        await expect(page.getByText(/^No rooms on .+ yet$/)).toBeVisible();
        await expectNoViolations(page);

        const room = (campusId: string, name: string, extra: object = {}) =>
          send(
            page,
            '/academics/rooms',
            { campusId, name, type: 'CLASSROOM', capacity: 40, ...extra },
            201,
          );
        await room(primary.id, 'Room 101', { floor: 'Ground' });
        const lab = await room(primary.id, 'Physics Lab', { type: 'LAB', capacity: 30 });
        await send(page, `/academics/rooms/${lab.id}/archive`, {}, 200);
        await room(north.id, 'North Hall', { type: 'HALL', capacity: 300 });

        await page.goto('/en/classes?tab=rooms');
        await expect(page.getByRole('heading', { level: 3, name: 'Room 101' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 3, name: 'Physics Lab' })).toBeVisible();
        // The other campus's rooms are not listed.
        await expect(page.getByRole('heading', { level: 3, name: 'North Hall' })).toHaveCount(0);
        await expectNoViolations(page);

        await page.getByRole('button', { name: 'Add room' }).click();
        const dialog = page.getByRole('dialog', { name: 'Add room' });
        await expect(dialog.getByLabel('Room name')).toBeFocused();
        await dialog.getByLabel('Capacity').fill('900');
        await dialog.getByRole('button', { name: 'Add room' }).click();
        await expect(dialog.getByText('Enter a capacity from 1 to 500.')).toBeVisible();
        // The pointer still rests on the submit button; its hover shade is not what is measured.
        await page.mouse.move(0, 0);
        await expectNoViolations(page);
      });

      /** Sets the school profile's class range, keeping the rest of the profile as it is. */
      const setClassRange = async (page: Page, lowestClass: string, highestClass: string) => {
        const read = await page.request.get(`${WEB_ORIGIN}/api/school/profile`);
        const {
          code: _code,
          logoUrl: _logo,
          ...profile
        } = (await read.json()) as Record<string, unknown>;
        const response = await page.request.put(`${WEB_ORIGIN}/api/school/profile`, {
          data: { ...profile, lowestClass, highestClass },
          headers: { origin: WEB_ORIGIN },
        });
        expect(response.status(), await response.text()).toBe(200);
      };

      const primaryCampusId = async (page: Page) => {
        const listed = await page.request.get(`${WEB_ORIGIN}/api/school/campuses`);
        const { campuses } = (await listed.json()) as {
          campuses: { id: string; isPrimary: boolean }[];
        };
        return campuses.find((campus) => campus.isPrimary)!.id;
      };

      test('/en/classes has no WCAG 2.1 AA violations, without a class range and with no sections', async ({
        page,
        playwright,
      }) => {
        await ownSchool(page, playwright);
        const year = currentAcademicYear();
        await send(
          page,
          '/school/academic-years',
          { startsOn: year.startsOn, endsOn: year.endsOn, termCount: 2 },
          201,
        );

        // No class range yet: a link to the school profile, and nothing to add to.
        await page.goto('/en/classes');
        await expect(tabs(page).getByRole('link', { name: 'Sections' })).toHaveAttribute(
          'aria-current',
          'page',
        );
        await expect(page.getByRole('link', { name: 'Open the school profile' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add section' })).toHaveCount(0);
        await expectNoViolations(page);

        // With a range and no earlier year: "Add your first section" and every class, empty.
        await setClassRange(page, 'XI', 'XII');
        await send(page, '/academics/streams', { name: 'Science' }, 201);
        await page.goto('/en/classes');
        await expect(page.getByText(`No sections in ${year.label} yet`)).toBeVisible();
        await expect(page.getByRole('heading', { level: 3, name: 'Class XII' })).toBeVisible();
        await expect(page.getByRole('button', { name: /^Copy / })).toHaveCount(0);
        await expectNoViolations(page);

        // The form for a senior class asks for a stream.
        await page.getByRole('button', { name: 'Add your first section' }).click();
        const dialog = page.getByRole('dialog', { name: 'Add a section to Class XI' });
        await expect(dialog.getByLabel('Stream')).toBeVisible();
        await dialog.getByLabel('Section name').fill('A');
        await dialog.getByLabel('Capacity').fill('40');
        await dialog.getByRole('button', { name: 'Add section' }).click();
        await expect(dialog.getByText('Choose a stream.')).toBeVisible();
        // The pointer still rests on the submit button; its hover shade is not what is measured.
        await page.mouse.move(0, 0);
        await expectNoViolations(page);
      });

      test('/en/classes has no WCAG 2.1 AA violations, copying from last year and in the form', async ({
        page,
        playwright,
      }) => {
        await ownSchool(page, playwright);
        const target = currentAcademicYear();
        const start = Number(target.startsOn.slice(0, 4));
        const previousLabel = `${start - 1}–${String(start).slice(2)}`;
        // Last year first, so it is current while its sections are added; then this year.
        const previous = await send(
          page,
          '/school/academic-years',
          { startsOn: `${start - 1}-04-01`, endsOn: `${start}-03-31`, termCount: 2 },
          201,
        );
        const current = await send(
          page,
          '/school/academic-years',
          { startsOn: target.startsOn, endsOn: target.endsOn, termCount: 2 },
          201,
        );
        await setClassRange(page, 'VI', 'XII');
        const campusId = await primaryCampusId(page);
        const science = await send(page, '/academics/streams', { name: 'Science' }, 201);
        const room = (name: string, capacity: number) =>
          send(page, '/academics/rooms', { campusId, name, type: 'CLASSROOM', capacity }, 201);
        const room101 = await room('Room 101', 40);
        const room102 = await room('Room 102', 30);
        const options = await page.request.get(
          `${WEB_ORIGIN}/api/academics/class-teacher-options?yearId=${previous.id}`,
        );
        const { teachers } = (await options.json()) as { teachers: { membershipId: string }[] };
        const section = (classLevel: string, name: string, extra: object = {}) =>
          send(
            page,
            '/academics/sections',
            { academicYearId: previous.id, campusId, classLevel, name, capacity: 40, ...extra },
            201,
          );
        await section('VI', 'A', {
          roomId: room101.id,
          classTeacherMembershipId: teachers[0]!.membershipId,
        });
        await section('VI', 'B', { roomId: room102.id });
        await section('XI', 'A', { streamId: science.id });
        // This year becomes current and last year closes; then a room is archived and XI leaves
        // the range, so the copy drops them.
        await send(page, `/school/academic-years/${current.id}/make-current`, {}, 200);
        await send(page, `/academics/rooms/${room102.id}/archive`, {}, 200);
        await setClassRange(page, 'VI', 'X');

        await page.goto('/en/classes');
        await expect(page.getByText(`No sections in ${target.label} yet`)).toBeVisible();
        const copy = page.getByRole('button', { name: `Copy 2 sections from ${previousLabel}` });
        await expect(copy).toBeVisible();
        await expectNoViolations(page);

        await copy.click();
        await expect(
          page.getByRole('heading', { level: 3, name: `2 sections copied from ${previousLabel}` }),
        ).toBeFocused();
        await expect(
          page.getByText('Not copied, as the class is outside your classes: XI-A.'),
        ).toBeVisible();
        await expect(
          page.getByText('Room left empty, as the room is archived: VI-B.'),
        ).toBeVisible();
        await expect(page.getByRole('heading', { level: 4, name: 'VI-A' })).toBeVisible();
        await expect(page.getByText('Room: Room 101')).toBeVisible();
        await page.mouse.move(0, 0);
        await expectNoViolations(page);

        // The form, warning that the room seats fewer than the section holds.
        await page.getByRole('button', { name: 'Edit VI-A' }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit VI-A' });
        await expect(dialog.getByLabel('Section name')).toHaveValue('A');
        await dialog.getByLabel('Capacity').fill('45');
        await expect(
          dialog.getByText(
            "Room 101 seats 40, fewer than this section's capacity of 45. You can still save.",
          ),
        ).toBeVisible();
        await expectNoViolations(page);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);

        // Last year, now closed: read-only, with XI outside the range listed last.
        await page.context().addCookies([{ name: 'cl_year', value: previous.id, url: WEB_ORIGIN }]);
        await page.goto('/en/classes');
        await expect(
          page.getByText(`${previousLabel} is closed, so its sections can't be changed.`, {
            exact: false,
          }),
        ).toBeVisible();
        await expect(page.getByText('Outside your classes', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Edit VI-A' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^Add section/ })).toHaveCount(0);
        await expectNoViolations(page);
      });

      test('/en/classes has no WCAG 2.1 AA violations with a class outside the range', async ({
        page,
        playwright,
      }) => {
        await ownSchool(page, playwright);
        const year = currentAcademicYear();
        const current = await send(
          page,
          '/school/academic-years',
          { startsOn: year.startsOn, endsOn: year.endsOn, termCount: 2 },
          201,
        );
        await setClassRange(page, 'IX', 'XII');
        const campusId = await primaryCampusId(page);
        const section = (classLevel: string) =>
          send(
            page,
            '/academics/sections',
            { academicYearId: current.id, campusId, classLevel, name: 'A', capacity: 40 },
            201,
          );
        await section('X');
        await section('XII');
        // XII leaves the range: its section stays, to be deleted but not edited.
        await setClassRange(page, 'IX', 'XI');

        await page.goto('/en/classes');
        const outside = page.getByRole('region', { name: 'Class XII' });
        await expect(outside).toHaveAccessibleDescription(
          'Outside your classes This class is no longer in the school profile. Its sections can be deleted, but not edited.',
        );
        await expect(outside.getByRole('button', { name: 'Delete XII-A' })).toBeVisible();
        await expect(outside.getByRole('button', { name: 'Edit XII-A' })).toHaveCount(0);
        await expect(outside.getByRole('button', { name: /^Add section/ })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Edit X-A' })).toBeVisible();
        await expectNoViolations(page);

        // Deleted, the class leaves with its last section and the tab's heading takes focus.
        await outside.getByRole('button', { name: 'Delete XII-A' }).click();
        const dialog = page.getByRole('dialog', { name: 'Delete XII-A?' });
        await expect(dialog).toBeVisible();
        await expectNoViolations(page);
        await dialog.getByRole('button', { name: 'Delete' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(outside).toHaveCount(0);
        await expect(page.locator('#sections-heading')).toBeFocused();
      });

      test.describe('subjects page', () => {
        const subjectTabs = (page: Page) =>
          page.getByRole('navigation', { name: 'Subjects views' });

        test('/en/subjects has no WCAG 2.1 AA violations, empty, in the starter picker and listed', async ({
          page,
          playwright,
        }) => {
          await ownSchool(page, playwright);

          // No subjects yet: the starter offer.
          await page.goto('/en/subjects');
          await expect(page.getByRole('heading', { level: 1, name: 'Subjects' })).toBeVisible();
          await expect(
            subjectTabs(page).getByRole('link', { name: 'Subjects', exact: true }),
          ).toHaveAttribute('aria-current', 'page');
          await expect(page.getByText('No subjects yet')).toBeVisible();
          const offer = page.getByRole('button', { name: "Add your board's starter subjects" });
          await expectNoViolations(page);

          // The picker: every CBSE starter subject ticked; one is unticked before adding.
          await offer.click();
          const picker = page.getByRole('dialog', { name: "Add your board's starter subjects" });
          await expect(picker.getByRole('checkbox', { name: /^Physics/ })).toBeChecked();
          await picker.getByRole('checkbox', { name: /^Psychology/ }).click();
          await expect(picker.getByRole('checkbox', { name: /^Psychology/ })).not.toBeChecked();
          await expectNoViolations(page);
          await picker.getByRole('button', { name: /^Add \d+ subjects$/ }).click();
          await expect(picker).toHaveCount(0);
          await expect(page.getByRole('heading', { level: 3, name: 'Physics' })).toBeVisible();
          await expect(
            page.getByRole('heading', { level: 2, name: 'Subjects', exact: true }),
          ).toBeFocused();

          // Listed, with an archived one shown on request.
          const listed = await page.request.get(`${WEB_ORIGIN}/api/academics/subjects`);
          const { subjects } = (await listed.json()) as {
            subjects: { id: string; name: string }[];
          };
          const biology = subjects.find((s) => s.name === 'Biology')!;
          await send(page, `/academics/subjects/${biology.id}/archive`, {}, 200);
          await page.goto('/en/subjects');
          await expect(page.getByRole('heading', { level: 3, name: 'Biology' })).toHaveCount(0);
          await page.getByRole('switch', { name: 'Show archived subjects (1)' }).click();
          await expect(page.getByRole('heading', { level: 3, name: 'Biology' })).toBeVisible();
          await expect(page.getByText('Code: 044')).toBeVisible();
          await expect(page.getByText('Co-scholastic').first()).toBeVisible();
          await page.mouse.move(0, 0);
          await expectNoViolations(page);

          // From the menu, the picker marks what is already added.
          await page.getByRole('button', { name: 'More subject actions' }).click();
          await page.getByRole('menuitem', { name: "Add your board's starter subjects" }).click();
          await expect(picker.getByRole('checkbox', { name: /^Physics/ })).toBeDisabled();
          await expect(picker.getByText('Already added').first()).toBeVisible();
          await expect(picker.getByRole('checkbox', { name: /^Psychology/ })).toBeEnabled();
          await expectNoViolations(page);
          await page.keyboard.press('Escape');
          await expect(picker).toHaveCount(0);

          // The add form, refused for a code with spaces.
          await page.getByRole('button', { name: 'Add subject' }).click();
          const dialog = page.getByRole('dialog', { name: 'Add subject' });
          await dialog.getByLabel('Subject name').fill('Sanskrit');
          await dialog.getByLabel('Code').fill('1 2');
          await dialog.getByRole('button', { name: 'Add subject' }).click();
          await expect(dialog.getByText('Use up to 10 letters, digits or hyphens.')).toBeVisible();
          await page.mouse.move(0, 0);
          await expectNoViolations(page);
        });

        test('/en/subjects?tab=class-subjects has no WCAG 2.1 AA violations, wide and at 375 px', async ({
          page,
          playwright,
        }) => {
          await ownSchool(page, playwright);
          await setClassRange(page, 'IX', 'XII');
          const science = await send(page, '/academics/streams', { name: 'Science' }, 201);
          await send(page, '/academics/streams', { name: 'Commerce' }, 201);
          const subject = (name: string, code?: string) =>
            send(page, '/academics/subjects', { name, code, type: 'SCHOLASTIC' }, 201);
          const english = await subject('English Core', '301');
          const physics = await subject('Physics', '042');
          await subject('Accountancy', '055');
          const maths = await subject('Mathematics', '041');
          const put = async (level: string, rows: unknown[]) => {
            const response = await page.request.put(
              `${WEB_ORIGIN}/api/academics/class-subjects/${level}`,
              { data: { rows }, headers: { origin: WEB_ORIGIN } },
            );
            expect(response.status(), await response.text()).toBe(200);
          };
          await put('IX', [{ subjectId: maths.id, streamId: null, kind: 'COMPULSORY' }]);
          await put('XI', [
            { subjectId: english.id, streamId: null, kind: 'COMPULSORY' },
            { subjectId: physics.id, streamId: science.id, kind: 'COMPULSORY' },
          ]);

          // Wide: a table of classes against subjects, with the stream selector.
          await page.setViewportSize({ width: 1280, height: 900 });
          await page.goto('/en/subjects?tab=class-subjects');
          await expect(
            subjectTabs(page).getByRole('link', { name: 'Class subjects' }),
          ).toHaveAttribute('aria-current', 'page');
          const grid = page.getByRole('region', { name: 'Class subjects grid' });
          await expect(grid).toBeVisible();
          await expect(page.getByLabel('Stream for classes XI and XII')).toBeVisible();
          await expect(
            grid.getByRole('button', { name: 'Mathematics, Class IX: Compulsory' }),
          ).toBeVisible();
          await expectNoViolations(page);

          // A change waits to be saved.
          await grid.getByRole('button', { name: 'Physics, Class X: Not taught' }).click();
          await expect(
            grid.getByRole('button', { name: 'Physics, Class X: Compulsory' }),
          ).toBeVisible();
          await expect(page.getByText('Class X has unsaved changes.')).toBeVisible();
          await page.mouse.move(0, 0);
          await expectNoViolations(page);

          // The Science stream's own rows. English is compulsory for all streams: named so, and
          // not a button here.
          await page.getByLabel('Stream for classes XI and XII').click();
          await page.getByRole('option', { name: 'Science' }).click();
          await expect(
            grid.getByRole('button', { name: 'Physics, Class XI, Science: Compulsory' }),
          ).toBeVisible();
          await expect(
            grid.getByText(
              'English Core, Class XI, Science: Compulsory (all streams) Set for all streams, ' +
                `so it's changed under "All streams".`,
              { exact: true },
            ),
          ).toBeAttached();
          await expect(
            grid.getByRole('button', { name: /^English Core, Class XI, Science:/ }),
          ).toHaveCount(0);
          await page.mouse.move(0, 0);
          await expectNoViolations(page);

          await page.getByRole('button', { name: 'Save Class X' }).click();
          await expect(page.getByText('Class X has unsaved changes.')).toHaveCount(0);

          // At 375 px: one accordion per class, and nothing wider than the screen.
          await page.setViewportSize({ width: 375, height: 812 });
          await page.goto('/en/subjects?tab=class-subjects');
          await expect(grid).toBeHidden();
          await page.getByRole('button', { name: 'Class XI', exact: true }).click();
          await expect(
            page.getByRole('button', { name: 'English Core, Class XI: Compulsory' }),
          ).toBeVisible();
          await page.getByRole('button', { name: 'Class X', exact: true }).click();
          await expect(
            page.getByRole('button', { name: 'Physics, Class X: Compulsory' }),
          ).toBeVisible();
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          ).toBe(true);
          await page.mouse.move(0, 0);
          await expectNoViolations(page);
        });

        test('/en/subjects?tab=class-subjects has no WCAG 2.1 AA violations with a class outside the range', async ({
          page,
          playwright,
        }) => {
          await ownSchool(page, playwright);
          await setClassRange(page, 'IX', 'XII');
          const maths = await send(
            page,
            '/academics/subjects',
            { name: 'Mathematics', type: 'SCHOLASTIC' },
            201,
          );
          const response = await page.request.put(
            `${WEB_ORIGIN}/api/academics/class-subjects/XII`,
            {
              data: { rows: [{ subjectId: maths.id, streamId: null, kind: 'COMPULSORY' }] },
              headers: { origin: WEB_ORIGIN },
            },
          );
          expect(response.status(), await response.text()).toBe(200);
          // XII leaves the range: its subjects are shown read-only, and can only be removed.
          await setClassRange(page, 'IX', 'XI');

          await page.setViewportSize({ width: 1280, height: 900 });
          await page.goto('/en/subjects?tab=class-subjects');
          const grid = page.getByRole('region', { name: 'Class subjects grid' });
          await expect(grid.getByText('Outside your classes', { exact: true })).toBeVisible();
          await expect(
            grid.getByText(
              "Mathematics, Class XII: Compulsory Can't be changed, as the class is outside your classes.",
            ),
          ).toBeAttached();
          await expect(grid.getByRole('button', { name: /Class XII:/ })).toHaveCount(0);
          await expect(
            grid.getByRole('button', { name: 'Mathematics, Class XI: Not taught' }),
          ).toBeVisible();
          const remove = grid.getByRole('button', { name: 'Remove all subjects from Class XII' });
          await expectNoViolations(page);

          // Cancelled, focus returns to the button; removed, to the tab's heading.
          await remove.click();
          const dialog = page.getByRole('dialog', { name: 'Remove all subjects from Class XII?' });
          await expect(dialog).toBeVisible();
          await expectNoViolations(page);
          await dialog.getByRole('button', { name: 'Cancel' }).click();
          await expect(dialog).toHaveCount(0);
          await expect(remove).toBeFocused();
          await remove.click();
          await dialog.getByRole('button', { name: 'Remove all' }).click();
          await expect(dialog).toHaveCount(0);
          await expect(page.getByText('Outside your classes', { exact: true })).toHaveCount(0);
          await expect(page.locator('#class-subjects-heading')).toBeFocused();
        });
      });
    });

    test.describe('setup wizard, checklist and switchers', () => {
      // Each test changes its school's setup, so each gets a school of its own.
      test.use({ storageState: { cookies: [], origins: [] } });

      /** A write through the web app's `/api` proxy, as the signed-in page would send it. */
      const send = async (page: Page, path: string, data: unknown, status: number) => {
        const response = await page.request.post(`${WEB_ORIGIN}/api${path}`, {
          data,
          headers: { origin: WEB_ORIGIN },
        });
        expect(response.status(), await response.text()).toBe(status);
      };

      /** A school of its own, signed in, past the dashboard's first-run redirect. */
      const ownSchool = async (page: Page, playwright: PlaywrightWorkerArgs['playwright']) => {
        const request = await playwright.request.newContext();
        const own = await createVerifiedSchool(request);
        await request.dispose();
        await signInWithCode(page.request, own);
        return own;
      };

      test('/en/onboarding has no WCAG 2.1 AA violations on each of its 4 steps', async ({
        page,
        playwright,
      }) => {
        const own = await ownSchool(page, playwright);
        const step = (name: string) => page.getByRole('heading', { level: 2, name });

        await page.goto('/en/onboarding');
        await expect(
          page.getByRole('heading', { level: 1, name: 'Set up your school' }),
        ).toBeVisible();
        await expect(step('School profile')).toBeVisible();
        await expect(page.getByLabel('School name')).toHaveValue(own.schoolName);
        await expect(page.getByRole('button', { name: 'Save and continue' })).toBeVisible();
        await expectNoViolations(page);

        await page.getByRole('button', { name: 'Skip' }).click();
        await expect(step('School logo')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Upload logo' })).toBeVisible();
        await expectNoViolations(page);

        await page.getByRole('button', { name: 'Skip' }).click();
        await expect(step('Academic year')).toBeVisible();
        await expect(page.getByLabel('Term 2 ends on')).toBeVisible();
        await expectNoViolations(page);

        await page.getByRole('button', { name: 'Skip' }).click();
        await expect(step('Campuses')).toBeVisible();
        await expect(page.getByLabel('Campus name')).toHaveValue(own.schoolName);
        await page.getByRole('button', { name: 'Add another campus' }).click();
        await expect(page.getByLabel('Campus name')).toHaveCount(2);
        await expect(page.getByRole('button', { name: 'Save and finish' })).toBeVisible();
        await expectNoViolations(page);

        // Unsaved edits ask before the step is left.
        await page.getByLabel('PIN code').first().fill('248001');
        await page.getByRole('button', { name: 'Back' }).click();
        await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
        await expectNoViolations(page);
      });

      test('/en/dashboard with the setup checklist has no WCAG 2.1 AA violations', async ({
        page,
        playwright,
      }) => {
        await ownSchool(page, playwright);
        await send(
          page,
          '/school/academic-years',
          { startsOn: '2026-04-01', endsOn: '2027-03-31', termCount: 2 },
          201,
        );

        await page.goto('/en/dashboard');
        await expect(page).toHaveURL(/\/en\/dashboard$/);
        await expect(
          page.getByRole('heading', { level: 2, name: 'Finish setting up your school' }),
        ).toBeVisible();
        await expect(page.getByText('1 of 5 done')).toBeVisible();
        // The fifth item, academics, opens the classes page rather than a wizard step.
        await expect(
          page.getByRole('link', { name: 'Add sections and class subjects (to do)' }),
        ).toHaveAttribute('href', '/en/classes');
        await expect(page.getByText('API online')).toBeVisible();
        await expectNoViolations(page);
      });

      test('the year switcher has no WCAG 2.1 AA violations, with no years and with 2', async ({
        page,
        playwright,
      }) => {
        await ownSchool(page, playwright);
        const openSwitcher = async () => {
          await page.getByRole('button', { name: /^AY / }).click();
          await expect(page.getByRole('menu')).toBeVisible();
        };

        await page.goto('/en/dashboard');
        await expect(page.getByText('API online')).toBeVisible();
        await expect(page.getByRole('button', { name: 'AY not set' })).toBeVisible();
        await openSwitcher();
        await expect(page.getByRole('menuitem', { name: 'Set up academic year' })).toBeVisible();
        await expectNoViolations(page);
        await page.keyboard.press('Escape');

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
        await page.goto('/en/dashboard');
        await expect(page.getByText('API online')).toBeVisible();
        await expect(page.getByRole('button', { name: 'AY 2026–27' })).toBeVisible();
        await openSwitcher();
        await expect(
          page.getByRole('menuitemradio', { name: '2026–27 (current)' }),
        ).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByRole('menuitemradio', { name: '2027–28' })).toBeVisible();
        await expectNoViolations(page);

        // The choice is remembered across a reload.
        await page.getByRole('menuitemradio', { name: '2027–28' }).click();
        await page.reload();
        await expect(page.getByRole('button', { name: 'AY 2027–28' })).toBeVisible();
      });

      test('the campus switcher has no WCAG 2.1 AA violations with 2 campuses', async ({
        page,
        playwright,
      }) => {
        const own = await ownSchool(page, playwright);
        await send(page, '/school/campuses', { name: 'North Campus' }, 201);

        await page.goto('/en/dashboard');
        await expect(page.getByText('API online')).toBeVisible();
        if ((page.viewportSize()?.width ?? 0) < 1024) {
          await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
        }
        await page.getByRole('button', { name: new RegExp(own.schoolName) }).click();
        await expect(
          page.getByRole('menuitemradio', { name: `${own.schoolName} (primary)` }),
        ).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByRole('menuitemradio', { name: 'North Campus' })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Manage campuses' })).toBeVisible();
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
