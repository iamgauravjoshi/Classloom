# Academic structure (Phase 1, Part 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A school sets up sections per academic year and campus (copied forward each year), streams for XI–XII, subjects from a board starter list mapped to classes, houses and rooms, through new Classes and Subjects pages.

**Architecture:**

- **New `academics` module in the API.** It owns streams, subjects, class subjects, houses, rooms and sections. All of these are tenant-owned under forced RLS, with composite `(id, tenant_id)` foreign keys, the shared `constraint-problem` mapper and Part 3's `AuditService`.
- **Shared rules in `@classloom/contracts`.** The starter lists, the class-range helper, the copy-forward mapping and the class-subject validation are pure, so the API and web agree.
- **Web app.** It replaces the `/classes` and `/subjects` placeholders with tabbed pages driven by the top-bar year and sidebar campus selection.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL 17 (RLS, `NULLS NOT DISTINCT` unique indexes), Next.js 16, next-intl, TanStack Query, Orval, react-hook-form + zod, shadcn/ui, Vitest, Testcontainers, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-11-04-academics-design.md` (section numbers refer to it). Base specs: Parts 3 and 4 in the same folder.

## Global Constraints

- **Branch and commits:**
  - Branch `feat/p1-academics` from `main` after PR #13 merges, or from `docs/academics-spec` if it is still open.
  - Use Conventional Commits with the harness's Co-Authored-By trailer.
  - Open one PR against `main`.
- **RLS on every new table:** `streams`, `subjects`, `class_subjects`, `houses`, `rooms` and `sections` are tenant-owned with forced RLS and listed in `TENANT_SCOPED_MODELS`. Every reference is a composite `(x_id, tenant_id)` FK.
- **Permissions:**
  - Sections, streams, houses, rooms and the class-teacher options: `classes.view` to read, `classes.manage` to change.
  - Subjects, the starter list and class subjects: `subjects.view` to read, `subjects.manage` to change.
- **Senior class:** a class level that is XI or XII.
- **Profile range:**
  - The class range is the school profile's `lowest_class`–`highest_class`.
  - If it isn't set, writes get 409 `classes-not-set`.
  - A class outside the range gets 422 `class-out-of-range`.
  - Rows outside a narrowed range stay readable and deletable, but can't be edited.
- **Field rules:**
  - stream name: 2–40 characters;
  - subject name: 2–60 characters; subject code: up to 10 characters (`[A-Za-z0-9-]`), not unique;
  - subject type: `SCHOLASTIC | CO_SCHOLASTIC`;
  - house name: 2–40 characters; house colour: `RED, BLUE, GREEN, YELLOW, ORANGE, PURPLE, PINK, TEAL, BROWN, GREY`;
  - room name: 1–40 characters, unique per campus; room type: `CLASSROOM, LAB, COMPUTER_LAB, LIBRARY, HALL, OTHER`; room capacity: 1–500; floor: up to 20 characters;
  - section name: 1–20 characters, trimmed; section capacity: 1–200;
  - every name is unique per school (rooms: per campus; sections: per year, campus and class), case-insensitive;
  - every status is `ACTIVE | ARCHIVED`.
- **Limits:** 200 subjects, 20 streams, 20 houses, 500 rooms, and 500 sections per year and campus. Going over gives 409 `academics-limit` with `{ limit }`.
- **Class teacher:**
  - Must be an ACTIVE membership of this school; otherwise 422 `teacher-unavailable`.
  - At most one section per teacher per academic year (unique index). Otherwise 409 `teacher-taken` with `{ sectionName }`.
- **Streams on sections:**
  - A senior class must have a stream when the school has any ACTIVE stream; otherwise 422 `stream-required`.
  - A junior class must not have one; otherwise 422 `stream-not-allowed`.
- **Problem types:** `classes-not-set`, `class-out-of-range`, `name-taken` (`{ field }`), `in-use` (counts), `academics-limit`, `academic-year-locked` (reused), `room-campus-mismatch`, `room-archived`, `teacher-unavailable`, `teacher-taken`, `stream-required`, `stream-not-allowed`, `sections-exist`, `nothing-to-copy`, and `subject-archived` (422: an archived subject newly added to a class, which refines spec §6's "can't be newly added").
- **Audit:** the actions and target types are listed in spec §4. `before` and `after` hold only the changed fields.
- **Starter lists:** spec §5, verbatim (names, codes, types, and the per-board composition).
- **Copy forward:**
  - The source is the latest year whose `ends_on` is before the target year's `starts_on`.
  - It copies the name, capacity, stream, room (if still ACTIVE on that campus) and teacher (if still ACTIVE and not already taken in the target year).
  - It returns `{ created, dropped: [{ section, field: 'room' | 'teacher' | 'stream' }] }` and writes one `sections.copied` audit row.
- **Onboarding:** `ONBOARDING_ITEMS` gains `academics`. It is done when the CURRENT year has at least one section and at least one class subject exists, and it links to `/classes`.
- **Pages:** `/[locale]/classes` (tabs: sections, streams, houses, rooms) and `/[locale]/subjects` (tabs: subjects, class subjects).
- **Web quality bar:**
  - All copy lives in `messages/en.json`.
  - Axe passes WCAG 2.1 AA in light and dark on the 6 device projects, with no overflow at 375 px. Touch targets are 44 px.
  - Use the `expectNoViolations` helper (it waits for animations).
- **Local E2E:** run with `E2E_API_PORT=4100 E2E_WEB_PORT=3200` and a web build made with `API_INTERNAL_URL=http://localhost:4100`.
- **pnpm on this machine:**
  - Use `npx -y pnpm@12.6.0 …` for scripts and installs.
  - Commit with the PATH shim that maps `pnpm exec X` to `node_modules/.bin/X`. Never use `--no-verify`.
  - Write files only inside the repo or the session scratchpad.

## Review Focus

1. **Copying into a year whose previous year shared rooms or teachers that have since changed.** A teacher who left, an archived room, or a teacher already leading a section in the target year are dropped and reported, never copied into a conflict (Task 4 test).
2. **Narrowing the profile range after setup.** For example, removing XI–XII leaves those sections and class subjects visible, marked outside the range, and deletable but not editable. The pages don't crash (Task 3 and Task 4 tests, Task 9 a11y).
3. **A school that adds its first stream after XI sections exist.** Existing stream-less XI sections stay valid. Editing one then asks for a stream (Task 4 test).
4. **The class-subject grid saved twice at once by two admins.** The class's rows are replaced atomically: the last write wins, and there are never duplicate rows (Task 3 test).
5. **Phone users on the class-subject grid.** Below `md` it's a per-class list with no horizontal scroll, and the stream selector stays usable (Task 8 a11y and Task 10 E2E at 375 px).

---

## File structure

```
packages/contracts/src/academics.ts (+ test)        enums, schemas, STARTER_SUBJECTS, STARTER_STREAMS, HOUSE_COLOURS
packages/contracts/src/academics-rules.ts (+ test)  isSeniorClass, classesInRange, isInRange, planCopyForward, checkClassSubjectRows
packages/contracts/src/onboarding.ts                + 'academics' item
apps/api/prisma/schema/academics.prisma             Stream, Subject, ClassSubject, House, Room, Section
apps/api/prisma/migrations/<ts>_academics/          tables, RLS, composite FKs, indexes, audit CHECK widening
apps/api/src/modules/academics/
  academics.module.ts, academics-problems.ts, academics-limits.ts (count helpers), class-range.ts (loads the profile range)
  streams.{service,controller}.ts, subjects.{service,controller}.ts, class-subjects.{service,controller}.ts
  houses.{service,controller}.ts, rooms.{service,controller}.ts, sections.{service,controller}.ts
apps/api/src/cli/school.commands.ts                 demo-setup extended
apps/web/src/features/academics/                    sections-tab, section-form, copy-forward, streams-tab, houses-tab, rooms-tab,
                                                    subjects-tab, starter-picker, class-subjects-grid, academics-errors
apps/web/src/app/[locale]/(app)/classes/page.tsx, subjects/page.tsx
apps/web/e2e/academics.spec.ts
```

---

### Task 1: Contracts and rules

**Files:** create `packages/contracts/src/academics.ts`, `academics-rules.ts` and their tests. Modify `onboarding.ts` and its test, and `index.ts`.

**Interfaces (Produces):**

- **Enums:**
  - `SUBJECT_TYPES`, `ROOM_TYPES`, `HOUSE_COLOURS`, `ACADEMIC_STATUSES` (`ACTIVE | ARCHIVED`), `CLASS_SUBJECT_KINDS` (`COMPULSORY | OPTIONAL`).
  - `SENIOR_CLASSES = ['XI', 'XII'] as const`.
- **Starter data:**
  - `STARTER_STREAMS = ['Science', 'Commerce', 'Humanities']`.
  - `STARTER_SUBJECTS: Record<Board, readonly { name: string; code?: string; type: SubjectType }[]>`, following spec §5. CBSE gets the primary list, then the scholastic table, then co-scholastic. The other boards get the primary list, then the generic list, then co-scholastic. Names are deduplicated within each board.
- **Schemas, each with request and response shapes:**
  - `streamSchema`, `subjectSchema`, `classSubjectRowSchema` (`{ subjectId, streamId: string | null, kind }`), `houseSchema`, `roomSchema`, `sectionSchema` (includes `room`, `stream` and `classTeacher: { membershipId, name, active } | null`);
  - the create, update and list schemas for each;
  - `starterSubjectsResponseSchema` (items with `exists`), `starterSubjectsRequestSchema`;
  - `copySectionsRequestSchema`, `copySectionsResponseSchema`;
  - `classTeacherOptionsResponseSchema`.
- **Rules (`academics-rules.ts`), all pure:**
  - `isSeniorClass(level: ClassLevel): boolean`.
  - `classesInRange(lowest: ClassLevel | null, highest: ClassLevel | null): ClassLevel[]` returns `[]` when either is null.
  - `isInRange(level, lowest, highest): boolean`.
  - `checkClassSubjectRows(level, rows): { ok: true } | { ok: false; index: number; problem: 'stream-not-allowed' | 'duplicate' }`. The duplicate check keys on `(subjectId, streamId)`.
  - `planCopyForward(source: CopySource[], ctx: { activeRoomIds: Set<string>; activeMemberIds: Set<string>; takenTeacherIds: Set<string>; activeStreamIds: Set<string> }): { create: CopyRow[]; dropped: { section: string; field: 'room' | 'teacher' | 'stream' }[] }`.
    - It drops a field (setting it to null) when it no longer qualifies.
    - A teacher is kept only once across the copied rows: the first in class order wins.
- **Onboarding:**
  - `ONBOARDING_ITEMS` becomes `['profile','logo','academicYear','campuses','academics']`.
  - `checklistOf` input gains `hasCurrentYearSection: boolean` and `hasClassSubject: boolean`.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **Starter lists:** every board's list has unique names, valid types and codes matching `/^[A-Za-z0-9-]{1,10}$/`.
  - **CBSE codes:** the list contains `{name:'English Language & Literature', code:'184'}`, `{name:'English Core', code:'301'}`, `{name:'Physics', code:'042'}`, and both Mathematics entries with `041`.
  - **`classesInRange`:**
    - `('UKG','II')` gives `['UKG','I','II']`;
    - `(null,'X')` gives `[]`.
  - **`checkClassSubjectRows`:**
    - `'VI'` with a stream gives `stream-not-allowed` at index 0;
    - `'XI'` with the same subject twice under the same stream gives `duplicate`;
    - the same subject under `null` and under a stream is ok.
  - **`planCopyForward`:**
    - drops an archived room, an inactive teacher, a teacher already taken in the target year, and an archived stream (each reported);
    - a teacher who led two source sections is kept only on the first.
  - **Checklist:** `checklistOf` marks `academics` done only when both new flags are true.
  - **Section schemas:** the create schema trims the name, rejects capacity 0 and 201, and accepts `streamId: null`.
- [ ] **Step 2:** Run `npx -y pnpm@12.6.0 --filter @classloom/contracts test`. Expect FAIL.
- [ ] **Step 3:** Implement. Rebuild the contracts dist.
- [ ] **Step 4:** Run. Expect PASS. Run the typecheck. Update the onboarding service's `checklistOf` call minimally, passing `false` for both flags with a `// academics: Task 7` marker, so it compiles.
- [ ] **Step 5:** Commit `feat(contracts): add academic structure rules and starter subjects`.

---

### Task 2: Schema and migration

**Files:**

- Create: `apps/api/prisma/schema/academics.prisma` and the migration `<ts>_academics`, with a timestamp after `20261103100000`.
- Modify: `tenancy.prisma` (relations), `tenant-scoped-models.ts`, `audit.service.ts` (union types).
- Test: `apps/api/test/academics/schema.int.test.ts`.

**Interfaces (Produces):** the Prisma models `Stream`, `Subject`, `ClassSubject`, `House`, `Room`, `Section`, with the spec §4 columns, and the enums `SubjectType`, `RoomType`, `HouseColour`, `AcademicStatus`, `ClassSubjectKind`. A unit test asserts that the Prisma enum values equal the contracts enums.

**Database constraints:**

- CHECKs for every length and range.
- Unique indexes:
  - `streams (tenant_id, lower(name))`, `subjects (tenant_id, lower(name))`, `houses (tenant_id, lower(name))`;
  - `rooms (tenant_id, campus_id, lower(name))`;
  - `sections (tenant_id, academic_year_id, campus_id, class_level, lower(name))`;
  - `sections (tenant_id, academic_year_id, class_teacher_membership_id) WHERE class_teacher_membership_id IS NOT NULL`;
  - `class_subjects (tenant_id, class_level, stream_id, subject_id) NULLS NOT DISTINCT`.
- Composite FKs:
  - sections reference academic years and campuses (CASCADE on year delete);
  - rooms, streams and memberships use ON DELETE RESTRICT, except the teacher and room, which SET NULL on their own column (Part 4 pattern);
  - class subjects reference subjects and streams (RESTRICT).
- **Sections and rooms on the same campus:** enforced by the service. The DB backs it with a composite FK `(room_id, campus_id, tenant_id)` against a unique `(id, campus_id, tenant_id)` on rooms.

**Steps:**

- [ ] **Step 1: Failing tests.** As the app role in tenant A:
  - **Uniqueness:** each unique index rejects a duplicate differing only in case (`23505`). The class-teacher index rejects the same teacher on two sections in one year but allows it across two years.
  - **Class subjects:** a duplicate row with `stream_id` null fails (`NULLS NOT DISTINCT`).
  - **Room campus:** a section whose room is on another campus fails the composite FK.
  - **Cross-school:** pointing at tenant B's subject, stream, room, year, campus or membership fails (`23503`).
  - **RLS:** B's rows are invisible, and inserting with B's `tenant_id` fails `WITH CHECK`.
  - **Audit CHECK:** accepts `sections.copied` and rejects `section.exploded`.
  - **Migration:** applies to Part 4 data with nothing backfilled.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement the hand-edited migration, copying the Part 4 migration's RLS and grants block.
- [ ] **Step 4:** Run the files, the full `test:int` and the typecheck. Expect PASS.
- [ ] **Step 5:** Commit `feat(api): add sections, streams, subjects, houses and rooms tables`.

---

### Task 3: Streams, subjects and class subjects API

**Files:**

- Create:
  - `apps/api/src/modules/academics/{academics.module,academics-problems,academics-limits,class-range}.ts`;
  - `streams.{service,controller}.ts`, `subjects.{service,controller}.ts`, `class-subjects.{service,controller}.ts`.
- Register the module in `app.module.ts`.
- Tests: `apps/api/test/academics/{streams,subjects,class-subjects}.int.test.ts`.

**Interfaces:**

- **Consumes:**
  - the Task 1 rules and schemas;
  - `AuditService.record`, `@RequirePermission`, `withTenant`;
  - `core/prisma/constraint-problem.ts` (map `23505` by index name to `name-taken` with the right `field`).
- **Produces:**
  - `ClassRange.load(tx, tenantId): Promise<{ lowest: ClassLevel | null; highest: ClassLevel | null }>`, reused by Task 4.
  - The `academics-problems.ts` exceptions for every spec §7 type.
  - `AcademicsLimits.assertBelow(tx, kind, tenantId, extra?)`.
- **Routes:** spec §6, with these operationIds:
  - streams: `listStreams`, `createStream`, `addStarterStreams`, `updateStream`, `archiveStream`, `restoreStream`, `deleteStream`;
  - subjects: `listSubjects`, `getStarterSubjects`, `addStarterSubjects`, `createSubject`, `updateSubject`, `archiveSubject`, `restoreSubject`, `deleteSubject`;
  - class subjects: `listClassSubjects`, `replaceClassSubjects`.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **Streams:**
    - `addStarterStreams` creates 3; a second call creates 0 and returns them as skipped.
    - Renaming to an existing name differing only in case gives 409 `name-taken` with `field: 'name'`.
    - Deleting a stream used by a class subject gives 409 `in-use` with `{ classSubjects: 1 }`.
    - Archive and restore each write one audit row.
  - **Subjects:**
    - `getStarterSubjects` for a CBSE school returns the CBSE list, with `exists` true for any name the school already has.
    - `addStarterSubjects` with 5 items, one existing, returns `{ created: 4, skipped: 1 }` and writes one `subjects.starter_added` row.
    - The 201st subject gives 409 `academics-limit`.
    - Two subjects with code 041 are both allowed.
  - **Class subjects:**
    - `replaceClassSubjects('XI', …)` with an "all streams" row and a Science row saves both.
    - `'VI'` with a stream gives 422 `stream-not-allowed`.
    - A class outside the range gives 422 `class-out-of-range`; with no range set, 409 `classes-not-set`.
    - An archived subject can be kept but not newly added (422 `subject-archived`).
    - One `class_subjects.updated` audit row is written, holding the before and after lists.
    - Two concurrent PUTs on the same class end with the rows of exactly one request and no duplicates (Review Focus 4).
    - With the range narrowed so XI is outside, GET still returns XI's rows with `outsideRange: true`, and a PUT on XI gives 422 (Review Focus 2).
  - **Permissions:**
    - A Teacher (with `classes.view` and `subjects.view`) can read; writes give 403.
    - A member without `subjects.view` gets 403 on `listSubjects`.
  - **Isolation:** B can't touch A's ids (404).
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. The class-subjects PUT locks with a per-school-and-class advisory lock, then runs delete plus createMany in one transaction.
- [ ] **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `feat(api): manage streams, subjects and class subjects`.

---

### Task 4: Houses, rooms and sections API

**Files:** create `houses.*`, `rooms.*` and `sections.{service,controller}.ts`. Tests: `apps/api/test/academics/{houses,rooms,sections}.int.test.ts`.

**Interfaces:**

- **Routes:** spec §6, with these operationIds:
  - houses: `listHouses`, `createHouse`, `updateHouse`, `archiveHouse`, `restoreHouse`, `deleteHouse`;
  - rooms: `listRooms`, `createRoom`, `updateRoom`, `archiveRoom`, `restoreRoom`, `deleteRoom`;
  - sections: `listSections`, `createSection`, `updateSection`, `deleteSection`, `copySectionsFromPrevious`, `listClassTeacherOptions`.
- **Consumes:** `planCopyForward`, `ClassRange.load`, and Part 4's academic-year lookup (`academic-year-locked` on CLOSED).
- **Response fields:**
  - sections in `listSections` carry `outsideRange: boolean`;
  - `classTeacher.active` reflects the membership status.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **Rooms:**
    - Create a room; a duplicate on the same campus differing only in case gives 409, and the same name on another campus is ok.
    - Deleting a room a section uses gives 409 `in-use`.
    - An archived room can't be picked for a new section (422 `room-archived`), but an existing section keeps it.
  - **Sections:**
    - **Creating:** create VI-A with a room and a teacher. The same teacher on VI-B in the same year gives 409 `teacher-taken` with `sectionName: 'A'`.
    - **Teachers:** a deactivated member gives 422 `teacher-unavailable`.
    - **Rooms:** a room from another campus gives 422 `room-campus-mismatch`.
    - **Streams:**
      - With an active stream, XI without a stream gives 422 `stream-required`, and VI with a stream gives 422 `stream-not-allowed`.
      - XI sections created before the school had any stream stay listed. Updating one without a stream then gives 422 `stream-required` (Review Focus 3).
    - **Closed years:** any section write in a CLOSED year gives 409 `academic-year-locked`.
    - **Narrowed range:** a section outside it is listed with `outsideRange`; PATCH gives 422 `class-out-of-range` and DELETE succeeds.
    - **Concurrency:** two concurrent creates of "A" for the same class end with one 201 and one 409 `name-taken`.
  - **Copy forward:**
    - Set up 2026–27 with 3 sections, prepare 2027–28, archive one room, deactivate one teacher, then copy. The result is `created: 3` and a `dropped` list naming the room and the teacher. One `sections.copied` audit row is written (Review Focus 1).
    - A second copy gives 409 `sections-exist`.
    - Copying into the first year gives 409 `nothing-to-copy`.
    - It only copies from the same campus.
  - **Class-teacher options:** lists active members with `sectionName` for those already leading a section that year.
  - **Permissions:** a Teacher can GET and gets 403 on writes.
  - **Isolation:** B gets 404 on A's ids.
  - **Audit:** every write writes exactly one row.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. Section writes take a per-school advisory lock (Part 4 pattern) before checking the teacher and the limit.
- [ ] **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `feat(api): manage houses, rooms and sections with copy-forward`.

---

### Task 5: Onboarding item, demo data and client regeneration

**Files:**

- Modify:
  - `apps/api/src/modules/school/onboarding.service.ts` (compute `hasCurrentYearSection` and `hasClassSubject`);
  - `apps/api/src/cli/school.commands.ts` (demo data, spec §11);
  - the README's CLI section.
- Regenerate `packages/api-client`. Wrap every DTO with nullable fields in `withNullableProperties`.
- Tests: the onboarding int test and the CLI int test.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **Onboarding:** the checklist has 5 items. `academics` turns true only after a section exists in the CURRENT year and a class subject exists.
  - **Demo setup:** `school:demo-setup` on a fresh school creates 2 streams, 3 rooms, sections for 2 classes in the current year, the CBSE starter subjects and some class subjects. Running it again creates nothing new.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. Regenerate the client, then check that `grep '"type": "array"' packages/api-client/openapi.json` shows only real arrays.
- [ ] **Step 4:** Run the API suites and the api-client and web typechecks. Expect PASS.
- [ ] **Step 5:** Commit `feat(api): add the academics onboarding item and demo data`.

---

### Task 6: Web: Streams, Houses and Rooms tabs

**Files:**

- Create:
  - `apps/web/src/features/academics/{streams-tab,houses-tab,rooms-tab,academics-errors}.tsx|ts`, plus `academics-errors.test.ts`;
  - `apps/web/src/app/[locale]/(app)/classes/page.tsx`, with the tab shell and the Sections tab as a stub that Task 7 fills.
- Modify: `config/nav.ts` and its test (`classes` and `subjects` no longer "coming soon"), `messages/en.json`, `a11y.spec.ts`.

**Interfaces (Produces):**

- `academicsProblemMessage(problem): string` maps every type in the global constraints, plus the reused ones.
- The tab shell uses a `?tab=` query parameter (`sections | streams | houses | rooms`).
- Edit controls appear only with `classes.manage`.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **Unit:** every problem type has an `en.json` key, and an unknown type falls back to the generic message.
  - **Nav:** `/classes` and `/subjects` are no longer in `comingSoonSections`.
  - **a11y:** the streams tab (empty, with the starter-streams helper, and with streams), the houses tab with swatches, and the rooms tab filtered by campus, in light and dark.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. House swatches use theme tokens that pass AA. Archive and delete use the shared `ConfirmDialog`.
- [ ] **Step 4:** Run the unit tests, then the a11y spec on desktop-chrome. Expect PASS.
- [ ] **Step 5:** Commit `feat(web): manage streams, houses and rooms`.

---

### Task 7: Web: Sections tab and copy-forward

**Files:** create `features/academics/{sections-tab,section-form,copy-forward}.tsx` and `section-helpers.ts` (+ test). Modify `messages/en.json` and `a11y.spec.ts`.

**Interfaces (Produces):**

- **`SectionsTab`:**
  - Reads `useSelectedYear()` and `useSelectedCampus()` (Part 4).
  - Groups sections by class level.
  - Shows cards at `md` and wider, rows below.
  - Shows each section's room and stream, and its teacher, with an "inactive" badge when the teacher's membership is no longer active.
- **`SectionForm({ section?, classLevel, onSaved })`:**
  - The stream field appears only for senior classes when there are active streams.
  - The room select lists only the campus's active rooms. It warns, without blocking, when the room's capacity is less than the section's.
  - The teacher select uses `listClassTeacherOptions`, showing who already leads a section.
- **Empty state:** "Copy N sections from 2025–26", or "Add your first section".
- **Copy result:** a summary of the dropped fields.
- **Helpers:** `groupByClass(sections, range)` orders by `CLASS_LEVELS`, marks `outsideRange`, and keeps empty in-range classes with an "Add section" action.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **Unit:** `groupByClass` orders Nursery…XII, includes empty in-range classes, and puts out-of-range classes last, flagged.
  - **a11y:** the sections tab (empty with a copy offer, populated, form open with a capacity warning, copy result with dropped items, and with no class range set, showing a link to the profile).
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the unit tests, then the a11y spec on desktop-chrome. Expect PASS.
- [ ] **Step 5:** Commit `feat(web): manage sections with copy from last year`.

---

### Task 8: Web: Subjects page and class-subject grid

**Files:**

- Create:
  - `features/academics/{subjects-tab,starter-picker,class-subjects-grid}.tsx` and `class-subjects-helpers.ts` (+ test);
  - `apps/web/src/app/[locale]/(app)/subjects/page.tsx`.
- Modify: `messages/en.json` and `a11y.spec.ts`.

**Interfaces (Produces):**

- **`StarterPicker`:** lists `getStarterSubjects` items, all ticked except those that already exist (disabled, marked "already added"). Submits the ticked ones.
- **`ClassSubjectsGrid`:**
  - **Wide screens:** rows are the in-range classes and columns are the active subjects (plus archived ones already mapped). Each cell cycles through none, compulsory and optional with a labelled control. For XI and XII, a stream selector switches between "All streams" and each stream.
  - **Below `md`:** a per-class accordion list of subjects with the same control.
  - **Saving:** saves one class at a time through `replaceClassSubjects`, with an unsaved-changes guard.
- **Helpers:** `class-subjects-helpers.ts` exports `toCellMap(rows)` and `rowsForClass(cellMap, level)`, the pure conversions.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **Unit:** `rowsForClass` round-trips the rows. Toggling a cell under a stream doesn't touch the "All streams" row for the same subject.
  - **a11y:** the subjects tab (empty with the starter call to action, populated, starter picker open), and the class-subjects grid at desktop width and at 375 px with the stream selector (Review Focus 5).
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the unit tests, then the a11y spec on desktop-chrome and iphone-14. Expect PASS.
- [ ] **Step 5:** Commit `feat(web): manage subjects and map them to classes`.

---

### Task 9: Web: onboarding item and out-of-range states

**Files:**

- Modify:
  - `features/onboarding/checklist-card.tsx` (the fifth item links to `/classes`);
  - `messages/en.json`;
  - the sections tab and the class-subjects grid, for out-of-range states if Tasks 7 and 8 left them as placeholders;
  - `a11y.spec.ts`.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **a11y:** the dashboard checklist card with 5 items. The sections tab and grid with an out-of-range class (read-only badge, Delete available, no Edit) (Review Focus 2).
  - **Unit:** the checklist card helper counts 5 items.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement. **Step 4:** Run on desktop-chrome. Expect PASS.
- [ ] **Step 5:** Commit `feat(web): add the academics setup item and out-of-range states`.

---

### Task 10: End to end

**Files:** create `apps/web/e2e/academics.spec.ts` and `docs/superpowers/followups/2026-11-04-academics.md` (header only). Modify `e2e/support/school.ts` with the helpers `setUpStreams`, `addRoom` and `addSection`.

**Steps:**

- [ ] **Step 1: Write the specs.**
  - **Sections.** An owner (past the wizard) sets the class range Nursery–XII, applies the starter streams and adds two rooms. They create VI-A (with a room and a teacher) and XI-A (Science). The year switcher keeps the selection.
  - **Copy forward.**
    1. Prepare next year and make it current.
    2. Archive one room, then copy from last year.
    3. The summary names the dropped room, and the copied sections are listed (Review Focus 1).
  - **Subjects.**
    1. Apply the CBSE starter list after unticking Psychology.
    2. Map English Core as compulsory for XI "All streams", and Physics as compulsory for XI Science.
    3. Save and reload: the mapping persists.
    4. The checklist's "Set up sections and subjects" is ticked.
  - **Houses.** Add two houses with colours.
  - **Read-only.** A Teacher with `classes.view` and `subjects.view` sees both pages with no edit controls. A member without them sees no nav items and gets access denied on direct URLs.
  - **Layout.** No horizontal scroll at 375 px on every tab (Review Focus 5).
- [ ] **Step 2:** Run on desktop-chrome, then all 6 projects. Expect PASS.
- [ ] **Step 3:** Commit `test(web): cover the academic structure end to end`.
