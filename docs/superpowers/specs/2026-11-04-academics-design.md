# Phase 1, Part 5: academic structure (sections, streams, subjects, houses, rooms)

Status: draft for review · Date: 2026-11-04 · Builds on: [Part 3: IAM](2026-11-02-iam-design.md), [Part 4: onboarding](2026-11-03-onboarding-design.md) · Research: [academics notes](../../research/academics.md)

## 1. Purpose

A school describes how it teaches:

- the sections it runs each year on each campus;
- the subjects it teaches and which classes take them;
- its XI–XII streams;
- its houses;
- its rooms.

Phase 2 admits each student into a year's section, and later modules (timetable, exams, report cards) read the subjects.

### Success criteria

- An admin sets up the current year's sections for a campus, each with a capacity, a room and a class teacher, in a few minutes.
- Next year's sections are created in one step by copying last year's, then edited.
- A CBSE school gets a correct starter subject list with board codes, trims it, and maps subjects to each class. XI–XII are mapped per stream, as compulsory or optional.
- Houses and rooms are recorded. Rooms are per campus, and sections use them.
- Only `classes.manage` and `subjects.manage` holders can change anything. `.view` holders see read-only pages.
- Every change is recorded in the audit trail.

### Decisions already made (with the user, 2026-11-04)

| Topic         | Decision                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Sections      | Belong to an academic year and a campus. "Copy from last year" sets up a new year in one step.           |
| Class teacher | Picked from the school's active staff now. Subject-teacher assignment comes with Staff/HR (Phase 3).     |
| Subjects      | A board starter list (CBSE with codes; other boards without codes) to accept, trim or extend.            |
| Scope         | Streams (XI–XII), houses and rooms are included, kept simple: no facilities, bookings, shifts or medium. |

## 2. Scope

**In scope:**

- sections;
- streams;
- subjects with the board starter lists;
- class subjects (compulsory or optional per class, and per stream for XI–XII);
- houses;
- rooms;
- the Classes and Subjects pages;
- one new onboarding checklist item;
- audit entries.

**Out of scope, and where each goes:**

- **Students in sections, house membership, section seat use:** Phase 2.
- **Subject teachers, departments:** Phase 3.
- **Periods, timetable, syllabus:** Phase 7.
- **Grading of co-scholastic areas:** Phase 8.
- **Section shift and medium, buildings, room facilities and bookings:** not planned yet. The research notes say when they'd fit.

## 3. Concepts

| Term          | Meaning                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Class         | A class level (`ClassLevel`, Nursery … XII) inside the school profile's `lowest_class`–`highest_class` range. It has no table of its own. |
| Section       | A group of students in one class, for one academic year, on one campus: "VI-A, 2026–27, Main campus".                                     |
| Stream        | A senior-secondary track (Science, Commerce, Humanities). It applies to XI and XII only.                                                  |
| Subject       | Something the school teaches: scholastic (marked) or co-scholastic (graded areas such as Art Education).                                  |
| Class subject | A subject offered to a class level (and, at XI–XII, to a stream), as compulsory or optional.                                              |
| House         | A school house (Red, Tagore, …) with a colour.                                                                                            |
| Room          | A physical room on a campus that a section can use.                                                                                       |

**Senior class:** a class level that is XI or XII.

**The profile range:** a school with no `lowest_class`/`highest_class` set can't create sections or class subjects. The pages link to the school profile first, and the API answers 409 `classes-not-set`.

## 4. Data model

All tables are tenant-owned under forced RLS. They are listed in `TENANT_SCOPED_MODELS` and have `created_at` and `updated_at`. Cross-table references use composite `(id, tenant_id)` foreign keys, as in Part 4, so a row can never point at another school's row.

### Stream (`streams`)

| Column            | Type | Rules                                                |
| ----------------- | ---- | ---------------------------------------------------- |
| `id`, `tenant_id` | uuid |                                                      |
| `name`            | text | 2–40 characters; unique per school, case-insensitive |
| `status`          | enum | `ACTIVE`, `ARCHIVED`                                 |

### Subject (`subjects`)

| Column            | Type  | Rules                                                                                                       |
| ----------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| `id`, `tenant_id` | uuid  |                                                                                                             |
| `name`            | text  | 2–60 characters; unique per school, case-insensitive                                                        |
| `code`            | text? | Up to 10 characters (letters, digits, `-`). A label, not unique: boards reuse codes across levels (see §5). |
| `type`            | enum  | `SCHOLASTIC`, `CO_SCHOLASTIC`                                                                               |
| `status`          | enum  | `ACTIVE`, `ARCHIVED`                                                                                        |

### Class subject (`class_subjects`)

| Column            | Type         | Rules                                                             |
| ----------------- | ------------ | ----------------------------------------------------------------- |
| `id`, `tenant_id` | uuid         |                                                                   |
| `class_level`     | `ClassLevel` | Inside the profile range, checked by the service                  |
| `stream_id`       | uuid?        | Set only for senior classes; null means "every stream"/non-senior |
| `subject_id`      | uuid         |                                                                   |
| `kind`            | enum         | `COMPULSORY`, `OPTIONAL`                                          |

**Uniqueness:** `(tenant_id, class_level, stream_id, subject_id)` is unique, with null `stream_id` treated as its own value (`NULLS NOT DISTINCT`).

**Rows without a stream:**

- For a junior class, `stream_id` is always null.
- For a senior class, a null `stream_id` means the subject applies to every stream of that class. For example, English Core is compulsory for all of XI.

### Section (`sections`)

| Column                        | Type         | Rules                                                                            |
| ----------------------------- | ------------ | -------------------------------------------------------------------------------- |
| `id`, `tenant_id`             | uuid         |                                                                                  |
| `academic_year_id`            | uuid         | FK to `academic_years`                                                           |
| `campus_id`                   | uuid         | FK to `campuses`                                                                 |
| `class_level`                 | `ClassLevel` | Inside the profile range                                                         |
| `stream_id`                   | uuid?        | Required for a senior class when the school has an active stream; otherwise null |
| `name`                        | text         | 1–20 characters, trimmed                                                         |
| `capacity`                    | smallint     | 1–200                                                                            |
| `room_id`                     | uuid?        | FK to `rooms`; the room must be on the same campus                               |
| `class_teacher_membership_id` | uuid?        | FK to `memberships` (same school)                                                |

**Uniqueness:**

- `(tenant_id, academic_year_id, campus_id, class_level, lower(name))` is unique.
- A teacher can be class teacher of at most one section per academic year, enforced by a unique index on `(tenant_id, academic_year_id, class_teacher_membership_id)` where the teacher is set.

### House (`houses`)

| Column            | Type | Rules                                                                                                                                            |
| ----------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`, `tenant_id` | uuid |                                                                                                                                                  |
| `name`            | text | 2–40 characters; unique per school, case-insensitive                                                                                             |
| `colour`          | enum | `RED`, `BLUE`, `GREEN`, `YELLOW`, `ORANGE`, `PURPLE`, `PINK`, `TEAL`, `BROWN`, `GREY`. Each maps to a theme token that passes AA in both themes. |
| `status`          | enum | `ACTIVE`, `ARCHIVED`                                                                                                                             |

### Room (`rooms`)

| Column            | Type     | Rules                                                          |
| ----------------- | -------- | -------------------------------------------------------------- |
| `id`, `tenant_id` | uuid     |                                                                |
| `campus_id`       | uuid     | FK to `campuses`                                               |
| `name`            | text     | 1–40 characters; unique per campus, case-insensitive           |
| `type`            | enum     | `CLASSROOM`, `LAB`, `COMPUTER_LAB`, `LIBRARY`, `HALL`, `OTHER` |
| `capacity`        | smallint | 1–500                                                          |
| `floor`           | text?    | Up to 20 characters ("Ground", "2")                            |
| `status`          | enum     | `ACTIVE`, `ARCHIVED`                                           |

### Limits

Each school can have at most:

- 200 subjects;
- 20 streams;
- 20 houses;
- 500 rooms;
- 500 sections per academic year and campus.

Going over a limit gives 409 `academics-limit` with `{ limit }`.

### Audit

`audit_events` gains:

- **Actions:**
  - `section.created`, `section.updated`, `section.deleted`, `sections.copied`;
  - `stream.created`, `stream.updated`, `stream.archived`, `stream.restored`, `stream.deleted`;
  - `subject.created`, `subject.updated`, `subject.archived`, `subject.restored`, `subject.deleted`, `subjects.starter_added`;
  - `class_subjects.updated`;
  - `house.created`, `house.updated`, `house.archived`, `house.restored`, `house.deleted`;
  - `room.created`, `room.updated`, `room.archived`, `room.restored`, `room.deleted`.
- **Target types:** `section`, `stream`, `subject`, `class_level`, `house`, `room`.

As before, `before` and `after` hold only the changed fields.

## 5. Board starter lists

These live in `@classloom/contracts` as `STARTER_SUBJECTS: Record<Board, { name; code?; type }[]>`. The picker shows the list with every item ticked. The school unticks what it doesn't teach and adds the rest in one request. Subjects whose name already exists are skipped, and the response reports them.

**CBSE, scholastic:**

| Name                          | Code |
| ----------------------------- | ---- |
| English Language & Literature | 184  |
| Hindi Course A                | 002  |
| Hindi Course B                | 085  |
| Mathematics (Standard)        | 041  |
| Mathematics (Basic)           | 241  |
| Science                       | 086  |
| Social Science                | 087  |
| Information Technology        | 402  |
| English Core                  | 301  |
| Physics                       | 042  |
| Chemistry                     | 043  |
| Biology                       | 044  |
| Mathematics                   | 041  |
| Computer Science              | 083  |
| Informatics Practices         | 065  |
| Economics                     | 030  |
| Business Studies              | 054  |
| Accountancy                   | 055  |
| History                       | 027  |
| Political Science             | 028  |
| Geography                     | 029  |
| Psychology                    | 037  |
| Physical Education            | 048  |

CBSE uses 041 for Mathematics in both class X and class XII. The starter list has "Mathematics (Standard)" (041) for IX–X and a senior "Mathematics" (041). The class-subject grid decides which classes take which. This is why subject codes are labels, not unique keys. Subject names stay unique.

**CBSE, co-scholastic:** Art Education, Health & Physical Education, Work Education. These have no codes.

**Primary (all boards, no codes):** English, Hindi, Mathematics, Environmental Studies (EVS), General Knowledge, Computer.

**ICSE, STATE, IB, CAMBRIDGE, OTHER:** the primary list plus English, a second language, Mathematics, Physics, Chemistry, Biology, History & Civics, Geography, Computer Applications, Economics and Commerce, all without codes, plus the three co-scholastic areas.

## 6. API (`/academics/...`)

Every write goes through `withTenant` and writes its audit row in the same transaction. Every route checks the permission shown.

### Streams

| Method and path                                   | Permission       | Behaviour                                                                                                        |
| ------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /academics/streams`                          | `classes.view`   | All streams, active first                                                                                        |
| `POST /academics/streams`                         | `classes.manage` | Creates one stream                                                                                               |
| `POST /academics/streams/starter`                 | `classes.manage` | Adds Science, Commerce and Humanities, skipping existing names                                                   |
| `PATCH /academics/streams/:id`                    | `classes.manage` | Renames                                                                                                          |
| `POST /academics/streams/:id/archive`, `/restore` | `classes.manage` |                                                                                                                  |
| `DELETE /academics/streams/:id`                   | `classes.manage` | Only while no section or class subject uses it; otherwise 409 `in-use` with `{ sections, classSubjects }` counts |

### Subjects

| Method and path                                    | Permission        | Behaviour                                                                                                                    |
| -------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /academics/subjects`                          | `subjects.view`   | All subjects, active first, then by name                                                                                     |
| `GET /academics/subjects/starter`                  | `subjects.view`   | The board's starter list, with `exists` per item                                                                             |
| `POST /academics/subjects/starter`                 | `subjects.manage` | `{ items: [{ name, code?, type }] }` from the starter list, edited. Creates the new ones and returns `{ created, skipped }`. |
| `POST /academics/subjects`                         | `subjects.manage` |                                                                                                                              |
| `PATCH /academics/subjects/:id`                    | `subjects.manage` |                                                                                                                              |
| `POST /academics/subjects/:id/archive`, `/restore` | `subjects.manage` | Archived subjects stay in class subjects but are shown as archived and can't be newly added                                  |
| `DELETE /academics/subjects/:id`                   | `subjects.manage` | Only while no class subject uses it; otherwise 409 `in-use`                                                                  |

### Class subjects

| Method and path                             | Permission        | Behaviour                                                                                                                                                                                |
| ------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /academics/class-subjects`             | `subjects.view`   | Every row, grouped by class level                                                                                                                                                        |
| `PUT /academics/class-subjects/:classLevel` | `subjects.manage` | Replaces that class's rows: `{ rows: [{ subjectId, streamId: string \| null, kind }] }`. One audit row (`class_subjects.updated`, target `class_level`) with the before and after lists. |

**Validation for the PUT:**

- The class must be inside the profile range; otherwise 409 `classes-not-set` or 422 `class-out-of-range`.
- Junior classes must not name a stream (422).
- Subjects must be active, or already present in that class.
- Streams must be active.

### Sections

| Method and path                               | Permission       | Behaviour                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /academics/sections?yearId&campusId`     | `classes.view`   | Sections of that year and campus, ordered by class level, then name. Includes room, stream and class teacher (name and active state).                                                                                                                                                                           |
| `POST /academics/sections`                    | `classes.manage` | Creates one section                                                                                                                                                                                                                                                                                             |
| `PATCH /academics/sections/:id`               | `classes.manage` |                                                                                                                                                                                                                                                                                                                 |
| `DELETE /academics/sections/:id`              | `classes.manage` | Allowed until Phase 2 adds students                                                                                                                                                                                                                                                                             |
| `POST /academics/sections/copy-from-previous` | `classes.manage` | `{ yearId, campusId }`. Copies the sections of the year that ended just before `yearId` (the latest year whose `ends_on` is before this year's `starts_on`) on that campus. Refused with 409 `sections-exist` if the target already has sections, and with 409 `nothing-to-copy` if the previous year has none. |

**Rules:**

- **Closed years:** a section in a CLOSED year can't be created, edited, deleted or copied into (409 `academic-year-locked`, reused from Part 4).
- **Rooms:** the room must be ACTIVE and on the section's campus. Otherwise 422 `room-campus-mismatch` or `room-archived`.
- **Class teachers:**
  - The teacher must be an ACTIVE membership of this school; otherwise 422 `teacher-unavailable`.
  - A teacher who already leads another section this year gives 409 `teacher-taken` with that section's name.
- **Streams:**
  - For a senior class, when the school has any active stream, `streamId` is required (422 `stream-required`).
  - For a junior class it must be null (422 `stream-not-allowed`).
- **Copying forward:**
  - Copies the name, capacity, stream, room (only if still active) and class teacher (only if still active and not already taken). It drops any of those that no longer qualify, and returns `{ created, dropped: [{ section, field }] }`.
  - It runs in one transaction with one `sections.copied` audit row.

### Houses and rooms

| Method and path                                                                                              | Permission                                  |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `GET /academics/houses`, `POST`, `PATCH /:id`, `POST /:id/archive`, `/restore`, `DELETE /:id`                | read `classes.view`, write `classes.manage` |
| `GET /academics/rooms?campusId&status`, `POST`, `PATCH /:id`, `POST /:id/archive`, `/restore`, `DELETE /:id` | read `classes.view`, write `classes.manage` |

**Delete rules:**

- A house can always be deleted until Phase 2.
- A room can be deleted only while no section uses it; otherwise 409 `in-use`, and the page suggests archiving.
- Archiving a room keeps its current sections, but it can't be picked for new ones.

**Class teacher picker:** `GET /academics/class-teacher-options?yearId` (`classes.manage`) returns the school's active members, with `{ membershipId, name, sectionName? }` showing any section they already lead that year.

## 7. Errors and edge cases

| Situation                                                      | Response                                                                                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Profile class range not set                                    | 409 `classes-not-set`                                                                                                                  |
| Class outside the profile range                                | 422 `class-out-of-range`                                                                                                               |
| A name already taken (stream, subject, house, room, section)   | 409 `name-taken`, with `{ field }`                                                                                                     |
| Deleting something still in use                                | 409 `in-use`, with counts                                                                                                              |
| A limit reached                                                | 409 `academics-limit`, with `{ limit }`                                                                                                |
| Section in a closed year                                       | 409 `academic-year-locked`                                                                                                             |
| Room on another campus, or archived                            | 422 `room-campus-mismatch`, or `room-archived`                                                                                         |
| Teacher not an active member                                   | 422 `teacher-unavailable`                                                                                                              |
| Teacher already leads a section this year                      | 409 `teacher-taken`, with `{ sectionName }`                                                                                            |
| Stream missing for a senior class, or set for a junior class   | 422 `stream-required`, or `stream-not-allowed`                                                                                         |
| Copy target already has sections, or nothing to copy           | 409 `sections-exist`, or `nothing-to-copy`                                                                                             |
| Two admins create the same section name at once                | One succeeds; the other gets 409 `name-taken` from the unique index                                                                    |
| Profile range narrowed after sections exist (e.g. XII removed) | Allowed. Sections and class subjects outside the range stay visible, marked "outside your classes", and can be deleted but not edited. |
| A staff member is deactivated while class teacher              | They stay on the section, shown as "inactive". Copy-forward drops them.                                                                |

## 8. Web

**Classes page** (`/[locale]/classes`, `classes.view`), with tabs:

- **Sections:**
  - Uses the top-bar year and sidebar campus selection.
  - Grouped by class level; each section shows a card on md+ and a row below.
  - **Shown on each:** stream, capacity, room and class teacher.
  - **Actions:** Add section, Edit, Delete.
  - **Empty year:** when the year and campus have no sections, offers "Copy N sections from 2025–26", or "Add your first section" when there is nothing to copy. After copying, a summary lists anything dropped.
- **Streams:** a list with an "Add Science, Commerce and Humanities" helper.
- **Houses:** a list with colour swatches.
- **Rooms:** filtered by the selected campus.

**Subjects page** (`/[locale]/subjects`, `subjects.view`), with tabs:

- **Subjects:**
  - The list, with type badges, archived toggled on and off.
  - Shows "Add your board's starter subjects" while the school has no subjects. Afterwards it's in the "⋯" menu.
- **Class subjects:**
  - A grid of the school's classes (rows) against active subjects (columns), with a compulsory or optional toggle per cell.
  - For XI and XII, a stream selector at the top switches between "All streams" and each stream.
  - On a phone it becomes a per-class list. Saving sends one class at a time.

**Common to both pages:**

- `.manage` holders see edit controls; `.view` holders see read-only pages.
- Navigation uses the existing `classes` and `subjects` items, which are no longer "coming soon".
- **Onboarding:** the Part 4 checklist gains a fifth item, `academics`: done when the current year has at least one section, and at least one class has a class subject. It links to `/classes`. The wizard is unchanged.

## 9. Migration

1. Create the new enums and the `streams`, `subjects`, `class_subjects`, `houses`, `rooms` and `sections` tables, with their RLS policies and grants. Composite foreign keys reference `campuses`, `academic_years`, `memberships`, `rooms`, `streams` and `subjects`.
2. Widen the `audit_events` CHECK.
3. No data is backfilled.

## 10. Testing

- **Unit tests:**
  - every starter list references only valid types, with no duplicate names per board;
  - the class-range helper;
  - the copy-forward mapping (what gets dropped and why);
  - the class-subjects PUT validation.
- **Integration tests (Testcontainers):**
  - uniqueness under concurrency, for section names and class teachers;
  - cross-school isolation for every table and composite FK;
  - closed-year locks;
  - the room's campus;
  - stream required or not allowed;
  - the `in-use` refusals;
  - copy-forward (happy path, dropped room or teacher, `sections-exist`, `nothing-to-copy`);
  - the starter list skipping existing subjects;
  - a narrowed profile range;
  - permission refusals for `classes.view` against `classes.manage` and `subjects.*`;
  - audit rows.
- **E2E on all device projects, with axe in light and dark:**
  - set up streams, rooms and sections for the current year;
  - prepare next year and copy sections forward;
  - apply the CBSE starter list and map subjects to XI Science;
  - houses;
  - a Teacher with only `.view` sees read-only pages;
  - the onboarding item ticks.

## 11. Acceptance checklist

- [ ] Migrations apply cleanly on a fresh database and on Part 4 data.
- [ ] Unit, integration and E2E tests pass on all six device projects with no axe violations, in both themes.
- [ ] Permissions are enforced in the API and reflected in the UI.
- [ ] Every change writes an audit event.
- [ ] All copy is in i18n files.
- [ ] `school:demo-setup` also creates two streams, three rooms, the current year's sections for two classes, and the CBSE starter subjects with a few class mappings.

## 12. Decisions made during the build

These refine the sections above. Each was ruled on during the build and is covered by tests.

### API (§4, §6)

- **Delete behaviour:** foreign keys use `ON DELETE NO ACTION` instead of `RESTRICT`. In-use rows are still refused, and deleting a whole school still cascades.
- **Rooms and campuses:** a room that sections use can't move to another campus. Sections can't change campus.
- **Problem types:** in addition to §7:
  - newly adding an archived stream (to a class or a section) is 422 `stream-archived`;
  - an archived subject newly added to a class is 422 `subject-archived`.
- **Status changes:** PATCH never changes `status`. Only the archive and restore routes do, so the audit trail has one shape.
- **Audit targets:** `class_subjects.updated` and `subjects.starter_added` use the school's id as the audit target, with the class level in before and after.
- **Sections:**
  - `POST /academics/sections` takes `academicYearId`.
  - Class-teacher options need `classes.manage`, because they list the school's staff.
  - Section labels in messages are class-qualified, for example "VI-A".
- **Copy forward:** it skips sections whose class is outside the current profile range and reports them in `dropped` with `field: 'class'`. If every section is skipped, it returns 201 with `created: 0`.
- **Class subjects:**
  - `GET /academics/class-subjects` returns `{ classes: [{ classLevel, outsideRange, rows }], streams }`. `streams` holds the active streams plus archived ones still referenced, so `subjects.*` roles can use the grid without `classes.view`.
  - A PUT with `rows: []` clears a class even when it's outside the range. Any non-empty PUT outside the range stays 422.
- **Academic years:** deleting an academic year that has sections is refused with 409 `in-use` and `{ sections }`, so copied sections are never lost silently.

### Web (§8)

- **Streams helper:** "Add Science, Commerce and Humanities" shows while any of the three is missing, and names only the missing ones.
- **Class-subject grid:** in a stream view, a subject set for all streams shows as "(all streams)" and can't be toggled for that stream.
- **Setup checklist:** it stays visible after the setup wizard, at "4 of 5", until the school has sections and class subjects.
- **Accessibility:** the shared primary button's hover colour fails AA contrast in light mode. That fix is a separate follow-up to `packages/ui`.
