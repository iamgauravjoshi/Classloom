import {
  type APIRequestContext,
  type Browser,
  expect,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs,
  test,
} from '@playwright/test';

import { inviteAs, newInvitee } from './support/invitations';
import {
  addRoom,
  addSection,
  closeToasts,
  createVerifiedSchool,
  setClassRange,
  setUpCurrentYear,
  setUpStreams,
  signInWithCode,
  type VerifiedSchool,
  WEB_ORIGIN,
} from './support/school';

// The academic structure (academics spec §8, §10): sections, copying them forward, subjects and
// class subjects, houses, read-only access and the narrow layout. Every test changes its school's
// academics, so each registers a school of its own.
test.use({ storageState: { cookies: [], origins: [] } });

/** Viewports narrower than Tailwind's lg show the sidebar as an off-canvas sheet. */
const isSheetLayout = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;
/** Below Tailwind's md the class-subjects grid is one accordion per class. */
const isAccordionLayout = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

/** A new school, its owner signed in to `page` (past the setup wizard). */
async function ownerPage(
  page: Page,
  playwright: PlaywrightWorkerArgs['playwright'],
): Promise<VerifiedSchool> {
  const request = await playwright.request.newContext();
  const school = await createVerifiedSchool(request);
  await request.dispose();
  await signInWithCode(page.request, school);
  return school;
}

/** The year after `year`, as "Prepare next year" fills it in: its label and dates. */
function yearAfter(year: { startsOn: string }) {
  const start = Number(year.startsOn.slice(0, 4)) + 1;
  return {
    label: `${start}–${String(start + 1).slice(2)}`,
    startsOn: `${start}-04-01`,
    endsOn: `${start + 1}-03-31`,
  };
}

/** The membership id of the signed-in owner, as the class-teacher picker offers it. */
async function ownerMembershipId(request: APIRequestContext, yearId: string, name: string) {
  const options = await request.get(
    `${WEB_ORIGIN}/api/academics/class-teacher-options?yearId=${yearId}`,
  );
  expect(options.status(), await options.text()).toBe(200);
  const { teachers } = (await options.json()) as {
    teachers: { membershipId: string; name: string }[];
  };
  const owner = teachers.find((teacher) => teacher.name === name);
  expect(owner, `class-teacher option ${name}`).toBeDefined();
  return owner!.membershipId;
}

const classesTabs = (page: Page) =>
  page.getByRole('navigation', { name: 'Classes and sections views' });
const subjectsTabs = (page: Page) => page.getByRole('navigation', { name: 'Subjects views' });

/** A section's card (or, below md, row), found by its "VI-A" heading. */
const sectionCard = (page: Page, label: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 4, name: label, exact: true }) });

/** An item of the streams, houses or rooms list, found by its heading. */
const itemCard = (page: Page, name: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) });

/** Picks `option` in the select labelled `label` (inside `scope`). */
async function choose(page: Page, scope: Page | Locator, label: string, option: string) {
  await scope.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
}

/** The main menu; below the `lg` breakpoint it is a sheet that the sidebar button opens. */
async function openNav(page: Page) {
  await expect(page.getByText('API online')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  if (isSheetLayout(page)) {
    await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  }
  await expect(nav).toBeVisible();
  return nav;
}

/**
 * A class-subjects cell button. Below md the class's accordion (named `classLabel`) is opened
 * first; from md the grid shows every cell.
 */
async function cell(page: Page, classLabel: string, name: string) {
  if (isAccordionLayout(page)) {
    const trigger = page.getByRole('button', { name: classLabel, exact: true });
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    return page.getByRole('button', { name, exact: true });
  }
  return page
    .getByRole('region', { name: 'Class subjects grid' })
    .getByRole('button', { name, exact: true });
}

test('an owner sets up streams, rooms and sections, and the year switcher keeps the year', async ({
  page,
  playwright,
}) => {
  test.slow();
  const school = await ownerPage(page, playwright);
  const year = await setUpCurrentYear(page.request);
  const campus = school.schoolName;

  // The class range, in the school profile.
  await page.goto('/en/settings/school-profile');
  await choose(page, page, 'Lowest class', 'Nursery');
  await choose(page, page, 'Highest class', 'Class XII');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('The school profile has been saved.')).toBeVisible();
  await closeToasts(page);

  // The starter streams.
  await page.goto('/en/classes?tab=streams');
  await expect(classesTabs(page).getByRole('link', { name: 'Streams' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByRole('button', { name: 'Add Science, Commerce and Humanities' }).click();
  for (const name of ['Science', 'Commerce', 'Humanities']) {
    await expect(page.getByRole('heading', { level: 3, name, exact: true })).toBeVisible();
  }
  await closeToasts(page);

  // Two rooms.
  await classesTabs(page).getByRole('link', { name: 'Rooms' }).click();
  await expect(page.getByRole('heading', { level: 2, name: `Rooms on ${campus}` })).toBeVisible();
  for (const [name, type, capacity] of [
    ['Room 101', 'Classroom', '40'],
    ['Physics Lab', 'Lab', '30'],
  ] as const) {
    await page.getByRole('button', { name: 'Add room' }).click();
    const form = page.getByRole('dialog', { name: 'Add room' });
    await form.getByLabel('Room name').fill(name);
    // A classroom unless another type is chosen.
    if (type !== 'Classroom') await choose(page, form, 'Type', type);
    await form.getByLabel('Capacity').fill(capacity);
    await form.getByRole('button', { name: 'Add room' }).click();
    await expect(form).toHaveCount(0);
    await closeToasts(page);
    await expect(itemCard(page, name).getByText(`${type} · ${capacity} seats`)).toBeVisible();
  }

  // Sections for this year, on the sidebar's campus: none yet, and nothing to copy.
  await classesTabs(page).getByRole('link', { name: 'Sections' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: `Sections in ${year.label} on ${campus}` }),
  ).toBeVisible();
  await expect(page.getByText(`No sections in ${year.label} yet`)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Copy / })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 3, name: 'Nursery' })).toBeVisible();

  // VI-A, with a room and the owner as class teacher.
  await page.getByRole('button', { name: 'Add section to Class VI', exact: true }).click();
  const sixth = page.getByRole('dialog', { name: 'Add a section to Class VI', exact: true });
  await sixth.getByLabel('Section name').fill('A');
  await sixth.getByLabel('Capacity').fill('40');
  // Junior classes have no stream.
  await expect(sixth.getByLabel('Stream', { exact: true })).toHaveCount(0);
  await choose(page, sixth, 'Room', 'Room 101 (40 seats)');
  await choose(page, sixth, 'Class teacher', school.name);
  await sixth.getByRole('button', { name: 'Add section' }).click();
  await expect(sixth).toHaveCount(0);
  await closeToasts(page);
  const sixthA = sectionCard(page, 'VI-A');
  await expect(sixthA.getByText('Capacity: 40 students · Room: Room 101')).toBeVisible();
  await expect(sixthA.getByText(`Class teacher: ${school.name}`)).toBeVisible();

  // XI-A in Science; the owner already leads VI-A, so can't be chosen again.
  await page.getByRole('button', { name: 'Add section to Class XI', exact: true }).click();
  const eleventh = page.getByRole('dialog', { name: 'Add a section to Class XI', exact: true });
  await eleventh.getByLabel('Section name').fill('A');
  await eleventh.getByLabel('Capacity').fill('35');
  await choose(page, eleventh, 'Stream', 'Science');
  await eleventh.getByLabel('Class teacher', { exact: true }).click();
  await expect(
    page.getByRole('option', { name: `${school.name}, class teacher of VI-A` }),
  ).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('option', { name: 'No class teacher' }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await eleventh.getByRole('button', { name: 'Add section' }).click();
  await expect(eleventh).toHaveCount(0);
  await closeToasts(page);
  const eleventhA = sectionCard(page, 'XI-A');
  await expect(
    eleventhA.getByText('Capacity: 35 students · No room · Stream: Science'),
  ).toBeVisible();
  await expect(eleventhA.getByText('No class teacher')).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Class VI', exact: true })
      .getByText('1 section', { exact: true }),
  ).toBeVisible();

  // A planned next year: choosing it in the top bar shows its (empty) sections, with last year's
  // offered to copy, and the choice survives a reload.
  const next = yearAfter(year);
  const planned = await page.request.post(`${WEB_ORIGIN}/api/school/academic-years`, {
    data: { startsOn: next.startsOn, endsOn: next.endsOn, termCount: 2 },
    headers: { origin: WEB_ORIGIN },
  });
  expect(planned.status(), await planned.text()).toBe(201);
  await page.reload();
  await expect(sectionCard(page, 'VI-A')).toBeVisible();
  const switcher = page.getByRole('button', { name: /^AY / });
  await expect(switcher).toHaveAccessibleName(`AY ${year.label}`);
  await switcher.click();
  await page.getByRole('menuitemradio', { name: next.label, exact: true }).click();
  await expect(switcher).toHaveAccessibleName(`AY ${next.label}`);
  await expect(
    page.getByRole('heading', { level: 2, name: `Sections in ${next.label} on ${campus}` }),
  ).toBeVisible();
  await expect(page.getByText(`No sections in ${next.label} yet`)).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Copy 2 sections from ${year.label}` }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: /^AY / })).toHaveAccessibleName(`AY ${next.label}`);
  await expect(page.getByText(`No sections in ${next.label} yet`)).toBeVisible();

  // Back to this year: its sections again.
  await page.getByRole('button', { name: /^AY / }).click();
  await page.getByRole('menuitemradio', { name: `${year.label} (current)` }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: `Sections in ${year.label} on ${campus}` }),
  ).toBeVisible();
  await expect(sectionCard(page, 'VI-A')).toBeVisible();
  await expect(sectionCard(page, 'XI-A')).toBeVisible();
});

test('next year copies last year’s sections, naming the room it had to leave out', async ({
  page,
  playwright,
}) => {
  test.slow();
  const school = await ownerPage(page, playwright);
  const year = await setUpCurrentYear(page.request);
  await setClassRange(page.request, 'NURSERY', 'XII');
  const streams = await setUpStreams(page.request);
  const room101 = await addRoom(page.request, { name: 'Room 101', capacity: 40 });
  const room102 = await addRoom(page.request, { name: 'Room 102', capacity: 40 });
  await addSection(page.request, {
    academicYearId: year.id,
    classLevel: 'VI',
    name: 'A',
    roomId: room101,
    classTeacherMembershipId: await ownerMembershipId(page.request, year.id, school.name),
  });
  await addSection(page.request, {
    academicYearId: year.id,
    classLevel: 'XI',
    name: 'A',
    roomId: room102,
    streamId: streams.Science!,
  });
  const next = yearAfter(year);

  // 1. Prepare next year and make it current.
  await page.goto('/en/settings/academic-years');
  await page.getByRole('button', { name: 'Prepare next year' }).click();
  const form = page.getByRole('dialog', { name: 'Prepare next year' });
  await expect(form.getByLabel('Label', { exact: true })).toHaveValue(next.label);
  await form.getByRole('button', { name: 'Create year' }).click();
  await expect(form).toHaveCount(0);
  await closeToasts(page);
  await page.getByRole('button', { name: `Make current: ${next.label}` }).click();
  const question = page.getByRole('dialog', { name: `Make ${next.label} the current year?` });
  await question.getByRole('button', { name: 'Make current' }).click();
  await expect(question).toHaveCount(0);
  await closeToasts(page);
  await expect(page.getByRole('button', { name: /^AY / })).toHaveAccessibleName(`AY ${next.label}`);

  // 2. Archive Room 101, then copy from last year.
  await page.goto('/en/classes?tab=rooms');
  await page.getByRole('button', { name: 'Archive Room 101' }).click();
  const archive = page.getByRole('dialog', { name: 'Archive Room 101?' });
  await archive.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(archive).toHaveCount(0);
  await closeToasts(page);
  await expect(page.getByRole('button', { name: 'Restore Room 101' })).toBeVisible();

  await classesTabs(page).getByRole('link', { name: 'Sections' }).click();
  await expect(page.getByText(`No sections in ${next.label} yet`)).toBeVisible();
  await page.getByRole('button', { name: `Copy 2 sections from ${year.label}` }).click();

  // 3. The summary names the dropped room, and the copied sections are listed.
  await expect(
    page.getByRole('heading', { level: 3, name: `2 sections copied from ${year.label}` }),
  ).toBeFocused();
  await expect(page.getByText("Some details weren't copied:")).toBeVisible();
  await expect(page.getByText('Room left empty, as the room is archived: VI-A.')).toBeVisible();
  const sixthA = sectionCard(page, 'VI-A');
  await expect(sixthA.getByText('Capacity: 40 students · No room')).toBeVisible();
  await expect(sixthA.getByText(`Class teacher: ${school.name}`)).toBeVisible();
  const eleventhA = sectionCard(page, 'XI-A');
  await expect(
    eleventhA.getByText('Capacity: 40 students · Room: Room 102 · Stream: Science'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Copy / })).toHaveCount(0);

  // Dismissed, the summary goes and the sections stay, after a reload too.
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('heading', { level: 3, name: /copied from/ })).toHaveCount(0);
  await page.reload();
  await expect(sectionCard(page, 'VI-A')).toBeVisible();
  await expect(sectionCard(page, 'XI-A')).toBeVisible();
});

test('the CBSE starter subjects are mapped to class XI, and the checklist item ticks', async ({
  page,
  playwright,
}) => {
  test.slow();
  await ownerPage(page, playwright);
  const year = await setUpCurrentYear(page.request);
  await setClassRange(page.request, 'NURSERY', 'XII');
  const streams = await setUpStreams(page.request);
  await addSection(page.request, {
    academicYearId: year.id,
    classLevel: 'XI',
    name: 'A',
    streamId: streams.Science!,
  });

  // A section but no class subjects yet: the item is still to do.
  await page.goto('/en/dashboard');
  await expect(page.getByText('API online')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Add sections and class subjects (to do)' }),
  ).toHaveAttribute('href', '/en/classes');

  // 1. The CBSE starter list, without Psychology.
  await page.goto('/en/subjects');
  await expect(
    subjectsTabs(page).getByRole('link', { name: 'Subjects', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: "Add your board's starter subjects" }).click();
  const picker = page.getByRole('dialog', { name: "Add your board's starter subjects" });
  const psychology = picker.getByRole('checkbox', { name: /^Psychology/ });
  await expect(psychology).toBeChecked();
  await psychology.click();
  await expect(psychology).not.toBeChecked();
  await picker.getByRole('button', { name: /^Add \d+ subjects$/ }).click();
  await expect(picker).toHaveCount(0);
  await closeToasts(page);
  for (const name of ['English Core', 'Physics', 'Art Education']) {
    await expect(page.getByRole('heading', { level: 3, name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { level: 3, name: 'Psychology' })).toHaveCount(0);

  // 2. English Core for all of XI, Physics for XI Science, both compulsory.
  await subjectsTabs(page).getByRole('link', { name: 'Class subjects' }).click();
  const stream = page.getByLabel('Stream for classes XI and XII');
  await expect(stream).toContainText('All streams');
  await (await cell(page, 'Class XI', 'English Core, Class XI: Not taught')).click();
  await expect(await cell(page, 'Class XI', 'English Core, Class XI: Compulsory')).toBeVisible();
  await expect(page.getByText('Class XI has unsaved changes.')).toBeVisible();

  await choose(page, page, 'Stream for classes XI and XII', 'Science');
  await (await cell(page, 'Class XI, Science', 'Physics, Class XI, Science: Not taught')).click();
  await expect(
    await cell(page, 'Class XI, Science', 'Physics, Class XI, Science: Compulsory'),
  ).toBeVisible();

  // 3. Saved, the mapping is still there after a reload.
  await page.getByRole('button', { name: 'Save Class XI' }).click();
  await expect(page.getByText('Subjects for Class XI have been saved.')).toBeVisible();
  await expect(page.getByText('Class XI has unsaved changes.')).toHaveCount(0);
  await closeToasts(page);

  await page.reload();
  await expect(page.getByLabel('Stream for classes XI and XII')).toContainText('All streams');
  await expect(await cell(page, 'Class XI', 'English Core, Class XI: Compulsory')).toBeVisible();
  await expect(await cell(page, 'Class XI', 'Physics, Class XI: Not taught')).toBeVisible();
  await choose(page, page, 'Stream for classes XI and XII', 'Science');
  await expect(
    await cell(page, 'Class XI, Science', 'Physics, Class XI, Science: Compulsory'),
  ).toBeVisible();
  await expect(
    await cell(page, 'Class XI, Science', 'English Core, Class XI, Science: Not taught'),
  ).toBeVisible();

  // 4. The checklist's academics item is done.
  await page.goto('/en/dashboard');
  await expect(page.getByText('API online')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Add sections and class subjects (done)' }),
  ).toHaveAttribute('href', '/en/classes');
});

test('houses are added with their colours', async ({ page, playwright }) => {
  await ownerPage(page, playwright);

  await page.goto('/en/classes?tab=houses');
  await expect(page.getByText('No houses yet')).toBeVisible();
  for (const [name, colour] of [
    ['Tagore House', 'Blue'],
    ['Raman House', 'Green'],
  ] as const) {
    await page.getByRole('button', { name: 'Add house' }).click();
    const form = page.getByRole('dialog', { name: 'Add house' });
    await form.getByLabel('House name').fill(name);
    await choose(page, form, 'Colour', colour);
    await form.getByRole('button', { name: 'Add house' }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByText(`${name} has been added.`)).toBeVisible();
    await closeToasts(page);
    // The colour is named in words beside its swatch.
    await expect(itemCard(page, name).getByText(colour, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('No houses yet')).toHaveCount(0);

  // They stay after a reload.
  await page.reload();
  await expect(itemCard(page, 'Tagore House').getByText('Blue', { exact: true })).toBeVisible();
  await expect(itemCard(page, 'Raman House').getByText('Green', { exact: true })).toBeVisible();
});

/** A school with a little of everything, so read-only pages and tabs have content to show. */
async function seedAcademics(request: APIRequestContext) {
  const year = await setUpCurrentYear(request);
  await setClassRange(request, 'VI', 'XII');
  const streams = await setUpStreams(request);
  const room = await addRoom(request, { name: 'Room 101' });
  await addSection(request, { academicYearId: year.id, classLevel: 'VI', name: 'A', roomId: room });
  await addSection(request, {
    academicYearId: year.id,
    classLevel: 'XI',
    name: 'A',
    streamId: streams.Science!,
  });
  const write = async (path: string, data: unknown, method: 'post' | 'put' = 'post') => {
    const response = await request[method](`${WEB_ORIGIN}/api${path}`, {
      data,
      headers: { origin: WEB_ORIGIN },
    });
    expect(response.status(), await response.text()).toBe(method === 'post' ? 201 : 200);
    return (await response.json()) as { id: string };
  };
  await write('/academics/houses', { name: 'Tagore House', colour: 'BLUE' });
  const english = await write('/academics/subjects', {
    name: 'English Core',
    code: '301',
    type: 'SCHOLASTIC',
  });
  const physics = await write('/academics/subjects', {
    name: 'Physics',
    code: '042',
    type: 'SCHOLASTIC',
  });
  await write(
    '/academics/class-subjects/XI',
    {
      rows: [
        { subjectId: english.id, streamId: null, kind: 'COMPULSORY' },
        { subjectId: physics.id, streamId: streams.Science!, kind: 'OPTIONAL' },
      ],
    },
    'put',
  );
  await write(
    '/academics/class-subjects/VI',
    { rows: [{ subjectId: english.id, streamId: null, kind: 'COMPULSORY' }] },
    'put',
  );
  return year;
}

test.describe('read-only access', () => {
  /** Joins the owner's school under `roleName` from a browser of its own, signed in. */
  async function joinAs(
    browser: Browser,
    baseURL: string | undefined,
    owner: APIRequestContext,
    roleName: string,
  ) {
    const link = await inviteAs(owner, newInvitee('Meera Joshi'), roleName);
    const context = await browser.newContext({ baseURL });
    const joined = await context.request.post(`${WEB_ORIGIN}/api/invitations/accept`, {
      data: { token: new URL(link).searchParams.get('token') },
      headers: { origin: WEB_ORIGIN },
    });
    expect(joined.status(), await joined.text()).toBe(200);
    return { context, page: await context.newPage() };
  }

  /** No button that adds, edits, archives, restores, deletes or copies in the page's content. */
  async function expectNoEditControls(page: Page, what: string) {
    await expect(
      page
        .locator('#main')
        .getByRole('button', { name: /^(Add|Edit|Archive|Restore|Delete|Copy|More|Save)\b/ }),
      what,
    ).toHaveCount(0);
  }

  test('a Teacher (classes.view and subjects.view) sees both pages without edit controls', async ({
    page,
    browser,
    baseURL,
    playwright,
  }) => {
    test.slow();
    await ownerPage(page, playwright);
    const year = await seedAcademics(page.request);
    // The built-in Teacher role views classes and subjects, and changes neither.
    const member = await joinAs(browser, baseURL, page.request, 'Teacher');
    const own = member.page;

    await own.goto('/en/dashboard');
    const nav = await openNav(own);
    await expect(nav.getByRole('link', { name: 'Classes & sections' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Subjects', exact: true })).toBeVisible();

    const classesNotice = 'You can view these. Ask someone who manages classes to change them.';
    await own.goto('/en/classes');
    await expect(own.getByText(classesNotice)).toBeVisible();
    await expect(own.getByText(`Sections in ${year.label}`, { exact: false })).toBeVisible();
    await expect(
      sectionCard(own, 'VI-A').getByText('Room: Room 101', { exact: false }),
    ).toBeVisible();
    await expect(
      sectionCard(own, 'XI-A').getByText('Stream: Science', { exact: false }),
    ).toBeVisible();
    await expectNoEditControls(own, 'sections');

    await classesTabs(own).getByRole('link', { name: 'Streams' }).click();
    await expect(own.getByRole('heading', { level: 3, name: 'Humanities' })).toBeVisible();
    await expect(own.getByText(classesNotice)).toBeVisible();
    await expectNoEditControls(own, 'streams');

    await classesTabs(own).getByRole('link', { name: 'Houses' }).click();
    await expect(itemCard(own, 'Tagore House').getByText('Blue', { exact: true })).toBeVisible();
    await expectNoEditControls(own, 'houses');

    await classesTabs(own).getByRole('link', { name: 'Rooms' }).click();
    await expect(own.getByRole('heading', { level: 3, name: 'Room 101' })).toBeVisible();
    await expectNoEditControls(own, 'rooms');

    const subjectsNotice = 'You can view these. Ask someone who manages subjects to change them.';
    await own.goto('/en/subjects');
    await expect(own.getByRole('heading', { level: 3, name: 'English Core' })).toBeVisible();
    await expect(own.getByText(subjectsNotice)).toBeVisible();
    await expectNoEditControls(own, 'subjects');

    await subjectsTabs(own).getByRole('link', { name: 'Class subjects' }).click();
    await expect(own.getByText(subjectsNotice)).toBeVisible();
    // The cells are shown but aren't buttons.
    await expect(
      own.getByText('English Core, Class XI: Compulsory', { exact: true }).first(),
    ).toBeAttached();
    await expect(own.getByRole('button', { name: /, Class (VI|XI)\b.*: / })).toHaveCount(0);
    await expectNoEditControls(own, 'class subjects');
    await member.context.close();
  });

  test('a member without classes.view or subjects.view has no menu items and is refused', async ({
    page,
    browser,
    baseURL,
    playwright,
  }) => {
    await ownerPage(page, playwright);
    // The built-in Librarian role has neither permission.
    const member = await joinAs(browser, baseURL, page.request, 'Librarian');
    const own = member.page;

    await own.goto('/en/dashboard');
    const nav = await openNav(own);
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Classes & sections' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Subjects', exact: true })).toHaveCount(0);

    for (const path of [
      '/en/classes',
      '/en/classes?tab=rooms',
      '/en/subjects',
      '/en/subjects?tab=class-subjects',
    ]) {
      await own.goto(path);
      await expect(
        own.getByRole('heading', { level: 2, name: "You don't have access to this page" }),
        path,
      ).toBeVisible();
      // Refused: none of the page's tabs or content.
      await expect(own.getByRole('navigation', { name: / views$/ }), path).toHaveCount(0);
      await expect(own.locator('#main').getByRole('heading', { level: 3 }), path).toHaveCount(0);
    }
    await member.context.close();
  });
});

test('no tab scrolls sideways at 375 px', async ({ page, playwright }) => {
  test.slow();
  await ownerPage(page, playwright);
  await seedAcademics(page.request);
  await page.setViewportSize({ width: 375, height: 812 });

  const tabs: [string, (page: Page) => Locator][] = [
    ['/en/classes?tab=sections', (p) => sectionCard(p, 'VI-A')],
    ['/en/classes?tab=streams', (p) => p.getByRole('heading', { level: 3, name: 'Science' })],
    ['/en/classes?tab=houses', (p) => p.getByRole('heading', { level: 3, name: 'Tagore House' })],
    ['/en/classes?tab=rooms', (p) => p.getByRole('heading', { level: 3, name: 'Room 101' })],
    ['/en/subjects?tab=subjects', (p) => p.getByRole('heading', { level: 3, name: 'Physics' })],
    [
      '/en/subjects?tab=class-subjects',
      (p) => p.getByRole('button', { name: 'Class XI', exact: true }),
    ],
  ];
  for (const [path, ready] of tabs) {
    await page.goto(path);
    await expect(ready(page), path).toBeVisible();
    if (path.endsWith('class-subjects')) {
      // Open, a class lists its subjects with their cells.
      await page.getByRole('button', { name: 'Class XI', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'English Core, Class XI: Compulsory' }),
      ).toBeVisible();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      path,
    ).toBe(true);
  }
});
