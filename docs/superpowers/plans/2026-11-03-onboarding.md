# School onboarding (Phase 1, Part 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A school's owner fills in the school profile, uploads a logo, sets up academic years with terms, and manages campuses. This happens through a skippable first-run wizard and Settings pages, and the year and campus switchers show real data.

**Architecture:**

- **New `school` module in the API.** It owns the profile, the logo, academic years with terms, campuses and the onboarding checklist. All of these are tenant-owned under forced RLS, with audit rows written through Part 3's `AuditService`.
- **New core `files` module.** It wraps an S3-compatible store (RustFS locally) and adds a sharp-based `ImageIntake`.
- **Shared rules in `@classloom/contracts`.** Pure rules (validators, term tiling, default terms, labels, checklist) live there, so the API and the web forms agree.
- **Web app.** It gains `features/school-settings/*` forms. These are used by the three Settings pages and by the `/onboarding` wizard.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL 17 (RLS, `btree_gist` exclusion constraint), `@aws-sdk/client-s3`, sharp, Next.js 16, next-intl, TanStack Query, Orval, shadcn/ui, Vitest, Testcontainers (Postgres, Redis, RustFS), Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-11-03-onboarding-design.md` (section numbers refer to it). Base specs: Parts 1 and 3 in the same folder.

## Global Constraints

- **Branch and commits:**
  - Branch `feat/p1-onboarding` from `main` after PR #11 merges.
  - Use Conventional Commits with the harness's Co-Authored-By trailer.
  - Open one PR against `main`.
- **RLS on every new table:** `school_profiles`, `files`, `academic_years` and `academic_terms` are tenant-owned with forced RLS and listed in `TENANT_SCOPED_MODELS`.
- **Permissions:**
  - Reads of the profile, the logo, years, active campuses and the checklist need any active member.
  - `GET /school/campuses?status=all` and the Settings pages need `settings.view`.
  - Every change needs `settings.manage`.
- **Profile fields** follow spec §4 exactly:
  - UDISE+ code: `^\d{11}$`, with the first two digits in 01–38.
  - PIN code: `^[1-9]\d{5}$`.
  - Affiliation number: `^[A-Za-z0-9/-]{1,30}$`.
  - Short name: 12 characters at most.
  - Established year: 1800 up to the current year.
  - Website: `https://`, 200 characters at most.
  - Address lines: 120 characters at most. City and district: 60 at most.
  - Medium: 40 characters at most.
  - Legal name: 150 characters at most.
- **Academic years:**
  - Status is `PLANNED | CURRENT | CLOSED`. Length is 180–400 days.
  - The label is 20 characters at most and unique per school, case-insensitive. The default form is `YYYY–YY`, with an en dash.
  - At most one `CURRENT` and one `PLANNED` year per school, and no overlap (gist exclusion).
- **Terms:**
  - 2 or 3 terms that tile the year exactly. Names are 40 characters at most; the defaults are "Term 1", "Term 2" and "Term 3".
  - April–March defaults:
    - 2 terms: Apr–Sep and Oct–Mar.
    - 3 terms: Apr–Jul, Aug–Nov and Dec–Mar.
  - Other years split their months as evenly as possible, and the earlier terms take the extra month.
- **Campuses:**
  - At most 20 per school, counting inactive ones. The name is unique per school, case-insensitive.
  - Exactly one primary campus. The primary campus can't be deactivated, and neither can the last active campus.
- **Logo:**
  - Uploads are PNG, JPEG or WebP, judged by the decoded format, up to 2 MB, with at least 64 px on each side.
  - sharp `limitInputPixels: 25_000_000`.
  - The output is PNG, auto-rotated, with the longest side at most 512 px (never enlarging) and no metadata.
  - At most 10 uploads per school per hour.
  - The URL is `/api/school/logo?v=<fileId>`, served with `Cache-Control: private, max-age=31536000, immutable`.
- **Problem types (spec §11):**
  - `academic-year-overlap`, `academic-year-planned-exists`, `academic-terms-invalid`, `academic-year-locked`, `academic-year-label-taken`
  - `campus-primary`, `campus-last-active`, `campus-name-taken`, `campus-limit`, `campus-inactive`
  - `logo-invalid` (with `reason`: `type | size | dimensions | decode`)
  - `storage-unavailable`
- **Audit actions:**
  - `school.profile_updated`, `school.logo_changed`, `school.logo_removed`
  - `academic_year.created`, `academic_year.updated`, `academic_year.made_current`, `academic_year.deleted`
  - `campus.created`, `campus.updated`, `campus.deactivated`, `campus.reactivated`, `campus.made_primary`
  - Target types: `school | academic_year | campus`.
- **Storage bucket:** the API creates the bucket on startup, as `docker/compose.yml` already says. This refines spec §5's `pnpm infra:up` wording. The health response gains `storage: 'up' | 'down'`, and storage never changes the status code.
- **Cookies:** `cl_year` (a year id) and `cl_campus` (a campus id). Both are `Path=/`, `SameSite=Lax`, one year long, and not httpOnly, because they only choose what the page displays.
- **Pages:**
  - `/[locale]/onboarding`
  - `/[locale]/settings/school-profile`
  - `/[locale]/settings/academic-years`
  - `/[locale]/settings/campuses`
- **Web quality bar:**
  - All copy lives in `messages/en.json`. Dates are shown as DD/MM/YYYY.
  - Axe passes WCAG 2.1 AA in light and dark on the 6 device projects, with no overflow at 375 px. Touch targets are 44 px.
  - Before an axe check, wait for animations to settle (see the `expectNoViolations` helper in `a11y.spec.ts`).
- **Local E2E:** run with `E2E_API_PORT=4100 E2E_WEB_PORT=3200` and a web build made with `API_INTERNAL_URL=http://localhost:4100`.
- **pnpm on this machine:** if `pnpm` can't start (a missing CRT DLL), run binaries from `node_modules/.bin`. Commit through the PATH shim that maps `pnpm exec X` to `node_modules/.bin/X`. Never use `--no-verify`.

## Review Focus

1. **A school in a non-April year (for example June–May).** Default terms are generated correctly, "Prepare next year" proposes the following June–May, and the label reads "2027–28" (Task 1 test, Task 5 test).
2. **Two admins editing at once.** Simultaneous "Make current" or "Make primary" calls leave exactly one current year and one primary campus, never zero or two (Task 5 and Task 6 concurrency tests).
3. **A phone photo as the logo.** A rotated JPEG with EXIF data, or a 4000×3000 image of about 1.9 MB, comes out upright, at most 512 px, with no GPS metadata (Task 3 fixtures).
4. **A stale year or campus cookie** after a year is deleted, or after a person switches schools. The switcher falls back to the default without an error, and another school's id is never shown (Task 10 test).
5. **Leaving the wizard halfway.** Signing out on step 2 and signing back in lands on the dashboard (the wizard opens only once), and the checklist reflects what was already saved (Task 7 test, Task 11 E2E).

---

## File structure

```
packages/utils/src/school-ids.ts (+ test)          isValidUdise, isValidAffiliationNumber, normalizeIndianPhone
packages/contracts/src/school.ts (+ test)          ClassLevel, enums, profile/year/term/campus/onboarding schemas
packages/contracts/src/academic-calendar.ts (+ test)  defaultTerms, checkTerms, yearLabel, nextYearDates
packages/contracts/src/onboarding.ts (+ test)      ONBOARDING_ITEMS, checklistOf
apps/api/prisma/schema/school.prisma               SchoolProfile, File, AcademicYear, AcademicTerm (+ Campus columns in tenancy.prisma)
apps/api/prisma/migrations/<ts>_school_onboarding/ tables, RLS, btree_gist, indexes, audit CHECK widening, backfill
apps/api/src/core/files/
  files.module.ts, file-storage.ts (interface + S3 impl), image-intake.ts (+ test), files.service.ts
apps/api/src/modules/school/
  school.module.ts
  profile.service.ts, profile.controller.ts, logo.controller.ts
  academic-years.service.ts, academic-years.controller.ts
  campuses.service.ts, campuses.controller.ts
  onboarding.service.ts, onboarding.controller.ts
  school-limits.ts                                 logo upload counter
apps/api/src/cli/school.commands.ts                school:demo-setup <code>
apps/web/src/features/school-settings/             profile-form, logo-field, academic-year-form, years-list, campus-form, campuses-list, school-errors
apps/web/src/features/onboarding/                  wizard, steps, checklist-card, leave-guard
apps/web/src/lib/selection-cookies.ts (+ test)     readSelection, pickYear, pickCampus
apps/web/src/app/[locale]/(app)/onboarding/page.tsx, settings/{school-profile,academic-years,campuses}/page.tsx
apps/web/e2e/onboarding.spec.ts, school-settings.spec.ts
```

---

### Task 1: Validators and school contracts

**Files:**

- Create: `packages/utils/src/school-ids.ts` (+ `school-ids.test.ts`), and export it from `index.ts`.
- Create: `packages/contracts/src/school.ts`, `academic-calendar.ts` and `onboarding.ts`, each with a test, and export them from `index.ts`.

**Interfaces (Produces):**

- **`@classloom/utils`:**
  - `isValidUdise(s: string): boolean`.
  - `isValidAffiliationNumber(s: string): boolean`.
  - `normalizeIndianPhone(raw: string): string | null`. It accepts mobiles and landlines (with the STD code). It strips spaces, hyphens, `+91` and a leading `0`, requires 10 digits with the first in 1–9, and returns `+91XXXXXXXXXX`.
- **`school.ts`, enums:**
  - `CLASS_LEVELS = ['NURSERY','LKG','UKG','I','II',…,'XII'] as const` and `ClassLevel`.
  - `SCHOOL_TYPES` = `CO_ED | BOYS | GIRLS`.
  - `RESIDENTIAL` = `DAY | BOARDING | DAY_AND_BOARDING`.
  - `ACADEMIC_YEAR_STATUSES`.
  - `MEDIUM_SUGGESTIONS: readonly string[]`.
- **`school.ts`, schemas:**
  - `schoolProfileSchema` (the response, including `name`, `board`, `code` and `logoUrl: string | null`).
  - `updateSchoolProfileRequestSchema`. Empty strings become `null`, and it refines `lowestClass ≤ highestClass` by `CLASS_LEVELS` index.
  - `academicTermSchema` and `academicYearSchema` (`{ id, label, startsOn, endsOn, status, terms }`, with dates as `YYYY-MM-DD` strings).
  - `createAcademicYearRequestSchema`, which accepts either `terms` or `termCount: 2|3`, with an optional `label`.
  - `updateAcademicYearRequestSchema` and `academicYearsResponseSchema`.
  - `campusSchema`, `createCampusRequestSchema`, `updateCampusRequestSchema` and `campusesResponseSchema`.
  - `onboardingResponseSchema` (`{ visible, items: { key, done }[], startedAt, dismissedAt }`).
- **`academic-calendar.ts`** works on plain `YYYY-MM-DD` strings, with no time zone:
  - `defaultTerms(startsOn: string, endsOn: string, count: 2 | 3): { name: string; startsOn: string; endsOn: string }[]`.
  - `checkTerms(year: { startsOn; endsOn }, terms): { ok: true } | { ok: false; index: number; problem: 'count' | 'start' | 'gap' | 'order' | 'end' }`.
  - `yearLabel(startsOn: string, endsOn: string): string` returns `"2026–27"`, or `"2026"` when both dates fall in one calendar year.
  - `yearLengthOk(startsOn, endsOn): boolean` checks 180–400 days, both inclusive.
  - `nextYearDates(current: { startsOn; endsOn }): { startsOn; endsOn }`: the day after `endsOn`, and the same length in months.
- **`onboarding.ts`:**
  - `ONBOARDING_ITEMS = ['profile','logo','academicYear','campuses'] as const`.
  - `checklistOf(input: { profile: { udiseCode; addressLine1; pinCode; phone; logoFileId }; hasCurrentYear: boolean; primaryCampus: { addressLine1; pinCode } }): { key; done }[]`, following spec §9.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **`isValidUdise`:** accepts `'09050100101'`; rejects `'39050100101'` (state 39), `'00050100101'`, 10 digits and letters.
  - **`isValidAffiliationNumber`:** accepts `'2130176'`, `'KA/EDN/2011/1187'`; rejects `''` and 31 characters.
  - **`normalizeIndianPhone`:**
    - `'098450 11223'` and `'+91 98450 11223'` give `'+919845011223'`;
    - `'080-41238800'` gives `'+918041238800'`;
    - `'12345'` and `'0000000000'` give `null`.
  - **`defaultTerms('2026-04-01','2027-03-31',2)`** gives `[{Term 1, 2026-04-01, 2026-09-30}, {Term 2, 2026-10-01, 2027-03-31}]`.
  - **With 3 terms** it gives `04-01..07-31`, `08-01..11-30`, `12-01..03-31`.
  - **`defaultTerms('2026-06-01','2027-05-31',3)`:** Jun–Sep, Oct–Jan, Feb–May.
  - **A 13-month year** with 2 terms gives 7 months then 6 (Review Focus 1).
  - **`checkTerms`:**
    - ok for every `defaultTerms` output;
    - `count` for 1 or 4 terms;
    - `start` when term 1 starts late;
    - `gap` when term 2 starts two days after term 1 ends;
    - `order` when a term ends before it starts;
    - `end` when the last term stops early.
  - **`yearLabel`:**
    - `('2026-04-01','2027-03-31')` gives `'2026–27'`, with an en dash;
    - `('2099-04-01','2100-03-31')` gives `'2099–00'`.
  - **`nextYearDates`** of Apr 2026–Mar 2027 gives Apr 2027–Mar 2028. Of a June–May year, it gives the next June–May.
  - **`yearLengthOk`:** false at 179 days, true at 180 and at 400, false at 401.
  - **`checklistOf`:**
    - all false for an empty profile;
    - `profile` is true only when all four fields are present;
    - `campuses` follows the primary campus's address and PIN.
  - **`updateSchoolProfileRequestSchema`:**
    - turns `''` into `null`;
    - rejects `lowestClass: 'XII', highestClass: 'I'`;
    - rejects a bad UDISE code with a field error on `udiseCode`.
- [ ] **Step 2:** Run `pnpm --filter @classloom/utils test school-ids` and `pnpm --filter @classloom/contracts test`. Expect FAIL.
- [ ] **Step 3:** Implement. Do date maths on `YYYY-MM-DD` strings with UTC `Date` parts only, never local time.
- [ ] **Step 4:** Run both. Expect PASS. Then run `pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(contracts): add school profile, academic calendar and onboarding rules`.

---

### Task 2: Schema, migration and registration

**Files:**

- Create: `apps/api/prisma/schema/school.prisma` and the migration `<ts>_school_onboarding`.
- Modify:
  - `tenancy.prisma` (Campus columns and the relations on `Tenant`);
  - `tenant-scoped-models.ts`;
  - `school-registration.service.ts` (create the `school_profiles` row in the registration transaction);
  - `audit.service.ts` (widen the `AuditAction` and `AuditTargetType` unions).
- Tests: `apps/api/test/school/schema.int.test.ts`, the registration int test, `tenant-scoped-models.test.ts`.

**Interfaces (Produces):**

- **Prisma models:**
  - `SchoolProfile` (PK `tenantId`; fields as in spec §4; `logoFile File?`).
  - `File { id, tenantId, purpose FilePurpose, storageKey, contentType, byteSize, width, height, sha256 Bytes, createdByUserId String? }`.
  - `AcademicYear { id, tenantId, label, startsOn @db.Date, endsOn @db.Date, status, terms AcademicTerm[] }`.
  - `AcademicTerm { id, tenantId, academicYearId, seq, name, startsOn, endsOn }`.
  - `Campus` gains `addressLine1? addressLine2? district? pinCode? phone? email?`.
- **Enums:**
  - `ClassLevel`, `SchoolType`, `Residential`, `AcademicYearStatus`, `FilePurpose { SCHOOL_LOGO }`.
  - The Prisma `ClassLevel` values equal `CLASS_LEVELS`, and a unit test asserts this.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **Migration on a seeded Part 3 database.** Use the same approach as `apps/api/test/iam/migration.int.test.ts`. After migrating:
    - every school has exactly one `school_profiles` row, with `city` and `state` copied from `tenants`;
    - there are no `academic_years` rows;
    - existing campuses keep their data, and the new columns are null.
  - **Migration guard.** A school with two primary campuses before the migration makes it abort with a message naming the problem.
  - **Constraints, as the app role in tenant A's context:**
    - Overlapping years make `INSERT` fail with exclusion violation `23P01`.
    - A second `CURRENT` year fails with unique violation `23505`, and so does a second `PLANNED` one.
    - A second primary campus fails with `23505`.
    - A label differing only in case fails with `23505`.
    - Terms with `seq` 4 fail the CHECK.
  - **RLS.** Tenant B's profile, files, years, terms and campuses are invisible, and inserting B's `tenant_id` fails `WITH CHECK`.
  - **Audit CHECK.** It accepts `campus.made_primary` and rejects `campus.exploded`.
  - **Registration.** A new school gets a profile row.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement the hand-edited migration:
  - `CREATE EXTENSION IF NOT EXISTS btree_gist`;
  - tables with CHECKs matching Global Constraints;
  - the exclusion constraint `daterange(starts_on, ends_on, '[]')`;
  - the partial unique indexes on years (`status`) and campuses (`is_primary`);
  - `lower(label)` and `lower(name)` unique indexes;
  - RLS policies and grants, copying the IAM migration's block;
  - the audit CHECK replaced with the widened list;
  - the guard, then the backfill.
- [ ] **Step 4:** Run the files, then the full `test:int` and `pnpm typecheck`. Expect PASS.
- [ ] **Step 5:** Commit `feat(api): add school profile, files, academic year and campus detail tables`.

---

### Task 3: Core files module and image intake

**Files:**

- Create: `apps/api/src/core/files/{files.module,file-storage,image-intake,files.service}.ts`, `image-intake.test.ts`, and fixtures in `apps/api/test/fixtures/images/`.
- Modify:
  - `env.schema.ts` (+ test): `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `S3_FORCE_PATH_STYLE` (default `true`);
  - `health.controller.ts` and its DTO (adds `storage: 'up' | 'down'`; storage being down never changes the status code);
  - `setup-containers.ts` (a RustFS container);
  - `.env.example`.
- Tests: `image-intake.test.ts` (unit), `apps/api/test/files.int.test.ts`.

**Interfaces (Produces):**

- **Storage:** `FileStorage { put(key, body: Buffer, contentType): Promise<void>; get(key): Promise<Readable>; delete(key): Promise<void>; ping(): Promise<boolean> }`. Inject it with the token `FILE_STORAGE`. `S3FileStorage` creates the bucket on module init if it's missing, and logs a warning instead of crashing when storage is down.
- **Intake:** `ImageIntake.toLogoPng(input: Buffer): Promise<{ data: Buffer; width: number; height: number; sha256: Buffer }>`. It throws `ImageRejectedError(reason: 'type'|'size'|'dimensions'|'decode')`.
- **Files service:** `FilesService.store(tx, { tenantId, purpose, image, userId }): Promise<{ fileId: string; storageKey: string }>`. It puts the object first, then inserts the row with `tx`. If the put fails, it throws `StorageUnavailableError`. `FilesService.removeObject(key)` swallows errors and logs them.

**Steps:**

- [ ] **Step 1: Failing tests.** Generate the fixtures with sharp in a small script that's committed with them.
  - **Accepted inputs:**
    - PNG, JPEG and WebP all come out as PNG with the longest side 512 and the aspect ratio kept.
    - A 300×100 PNG stays 300×100.
    - A JPEG with EXIF orientation 6 and GPS tags comes out upright (width < height). Its output metadata has no `exif` and no `orientation` (Review Focus 3).
  - **Rejected inputs and their reasons:**
    - an SVG (even renamed `.png`) and a GIF give `type`;
    - 2 MB + 1 byte gives `size`;
    - 63×200 gives `dimensions`;
    - a truncated PNG gives `decode`;
    - a PNG whose header declares 30000×30000 gives `decode` or `dimensions` without allocating, and finishes in under 2 s.
  - **Integration with RustFS:**
    - `store` writes an object readable by `get`, with the key shape `tenants/<tenantId>/school_logo/<fileId>.png`;
    - with the container stopped, `store` throws `StorageUnavailableError` and no row is inserted;
    - `/health` reports `storage: 'down'` but still returns 200 when the database and Redis are up.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement, adding `sharp` and `@aws-sdk/client-s3` to `apps/api` at exact versions. **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `feat(api): add S3 file storage and safe image intake`.

---

### Task 4: Profile and logo API

**Files:**

- Create:
  - `apps/api/src/modules/school/{school.module,profile.service,profile.controller,logo.controller,school-limits}.ts`;
  - `apps/api/src/modules/school/school-problems.ts`, which maps the spec §11 problem types to typed exceptions shared by Tasks 4–7.
- Register `SchoolModule` in `app.module.ts`.
- Test: `apps/api/test/school/profile.int.test.ts`.

**Interfaces:**

- **Consumes:**
  - `AuditService.record` (Part 3);
  - `@RequirePermission` (Part 3);
  - `FilesService` and `ImageIntake` (Task 3);
  - the Task 1 schemas.
- **Routes** (operationIds in brackets):
  - `GET /school/profile` [`getSchoolProfile`]
  - `PUT /school/profile` [`updateSchoolProfile`]
  - `PUT /school/logo` [`uploadSchoolLogo`], multipart field `file`
  - `DELETE /school/logo` [`removeSchoolLogo`]
  - `GET /school/logo` [`getSchoolLogo`]
- **Produces:** `ProfileService.load(tx)`, which Task 7 reuses for the checklist.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **Reading.** A Teacher (no settings permissions) can `GET /school/profile`, which returns the name, board, code, `logoUrl: null` and null fields.
  - **Permissions.** A Teacher's `PUT` gets 403 `permission-denied`.
  - **Saving.**
    - An Admin's `PUT` with every field saves them all.
    - The phone is stored as E.164.
    - `name` and `board` change on `tenants`, and so do `city` and `state`.
    - Exactly one `school.profile_updated` audit row is written, whose `before` and `after` hold only the changed keys.
  - **Validation.** A bad UDISE code or PIN gives 400 with field errors. `''` for an optional field stores `null`.
  - **Uploading a logo.**
    - `PUT /school/logo` with a valid JPEG gives 200 with `logoUrl` equal to `/api/school/logo?v=<fileId>`.
    - `GET` that URL returns `image/png`, `ETag: "<fileId>"` and the immutable `Cache-Control`.
    - A `school.logo_changed` row is written.
  - **Replacing and removing.**
    - Uploading a second logo deletes the first object from storage, and its row is kept.
    - `DELETE` clears the logo: `GET` returns 404 and a `school.logo_removed` row is written.
  - **Refusals.**
    - An SVG gives 422 `logo-invalid` with `reason: 'type'`.
    - With storage down, an upload gives 503 `storage-unavailable` and the profile is unchanged.
    - The 11th upload in an hour gives 429.
  - **Isolation.** School B can't see school A's logo. Its `GET /school/logo?v=<A's fileId>` returns B's logo or 404, never A's bytes.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement. Copy `IamLimits`' fail-open Redis pattern into `school-limits.ts`. **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `feat(api): edit the school profile and upload a logo`.

---

### Task 5: Academic years API

**Files:** create `academic-years.service.ts` and `academic-years.controller.ts`. Test: `apps/api/test/school/academic-years.int.test.ts`.

**Interfaces:**

- **Consumes:** `checkTerms`, `defaultTerms`, `yearLabel` and `yearLengthOk` (Task 1).
- **Routes:** spec §6's routes, with these operationIds:
  - `listAcademicYears`
  - `createAcademicYear`
  - `updateAcademicYear`
  - `makeAcademicYearCurrent`
  - `deleteAcademicYear`
- **Database errors:** map Postgres `23P01` to `academic-year-overlap`. Map `23505`, by constraint name, to `academic-year-planned-exists` or `academic-year-label-taken`. Check `meta.target` and fall back to the message (the Part 3 follow-up).

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **The first year.** `POST` with `{ startsOn: '2026-04-01', endsOn: '2027-03-31', termCount: 3 }` gives 201 with status `CURRENT`, label `2026–27` and the three default terms.
  - **The next year.** A second, non-overlapping year is `PLANNED`.
  - **Refused creates:**
    - a third year gives 409 `academic-year-planned-exists`;
    - an overlapping year gives 409 `academic-year-overlap`;
    - terms with a gap give 422 `academic-terms-invalid`, with the index;
    - a 179-day year gives 400.
  - **A June–May year** with `termCount: 2` gets the terms from Task 1 (Review Focus 1).
  - **Editing.** `PATCH` replaces the terms in one transaction. Moving the year's end date without fixing the terms gives 422, and nothing changes.
  - **Make current.** It turns `PLANNED` into `CURRENT` and the old `CURRENT` into `CLOSED`, and writes one `academic_year.made_current` row whose `before` and `after` hold both ids.
  - **Closed and current years:**
    - `PATCH`, make-current or `DELETE` on a `CLOSED` year gives 409 `academic-year-locked`;
    - `DELETE` on the `CURRENT` year gives 409 as well.
    - `DELETE` on a `PLANNED` year gives 204, and its terms cascade.
  - **Concurrency.** Two simultaneous make-current calls on the same planned year: one 200, one 409, and afterwards exactly one `CURRENT` year (Review Focus 2).
  - **Labels.** A duplicate label differing only in case gives 409 `academic-year-label-taken`.
  - **Permissions.** A Teacher can list but gets 403 on `POST`.
  - **Isolation.** B can't `PATCH` A's year (404).
  - **Audit.** Every write produces exactly one audit row.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement. Make-current locks the school's years with `SELECT … FOR UPDATE` inside `withTenant`, then re-reads the status. **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `feat(api): manage academic years and terms`.

---

### Task 6: Campuses API

**Files:** create `campuses.service.ts` and `campuses.controller.ts`. Test: `apps/api/test/school/campuses.int.test.ts`.

**Interfaces:** spec §7's routes, with these operationIds:

- `listCampuses` (`?status=active|all`)
- `createCampus`
- `updateCampus`
- `makeCampusPrimary`
- `deactivateCampus`
- `reactivateCampus`

The response orders the primary campus first, then the rest by name.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **Listing.**
    - Any member gets the active campuses, with the primary first.
    - `?status=all` without `settings.view` gives 403; with it, inactive campuses are included.
  - **Creating and editing.**
    - `POST` adds a campus: 201 and a `campus.created` row.
    - A duplicate name differing only in case gives 409 `campus-name-taken`.
    - The 21st campus, counting inactive ones, gives 409 `campus-limit`.
    - `PATCH` edits the address and contact. The PIN and phone are validated, and the phone is stored as E.164.
  - **Make primary.** It moves the flag, so exactly one campus is primary afterwards, and writes a `campus.made_primary` row. On an inactive campus it gives 409 `campus-inactive`.
  - **Deactivating.**
    - Deactivating the primary campus gives 409 `campus-primary`.
    - With two active campuses, deactivating the non-primary one succeeds. Deactivating the remaining one then gives 409 `campus-primary`, because it's both primary and last.
    - In a school whose only active campus is non-primary (set up through SQL), deactivating it gives 409 `campus-last-active`.
  - **Reactivating** works and writes a `campus.reactivated` row.
  - **Concurrency.** Simultaneous make-primary calls on two different campuses leave exactly one primary (Review Focus 2).
  - **Isolation.** B can't act on A's campus (404).
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement. Primary and deactivate changes lock the school's campus rows with `FOR UPDATE` and re-check after the lock (Part 3's `loadLocked` pattern). **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `feat(api): manage campuses with one primary and one active campus always`.

---

### Task 7: Onboarding API and client regeneration

**Files:**

- Create: `onboarding.service.ts` and `onboarding.controller.ts`.
- Create: `apps/api/src/cli/school.commands.ts` (`school:demo-setup <code>`). It fills a school with a full profile, a generated logo, a current year with 3 terms and a second campus. This is the acceptance "seed data".
- Regenerate `packages/api-client` (`pnpm --filter @classloom/api-client generate`).
- Test: `apps/api/test/school/onboarding.int.test.ts`.

**Interfaces:**

- **Routes:**
  - `GET /school/onboarding` [`getOnboarding`]
  - `POST /school/onboarding/start` [`startOnboarding`]
  - `POST /school/onboarding/dismiss` [`dismissOnboarding`]
- **Behaviour:**
  - The response is built with `checklistOf` (Task 1).
  - `visible` is false for members without `settings.manage`, when every item is done, or when the checklist was dismissed.
  - `start` and `dismiss` set their timestamps only if they're null, and return 204.
- **Produces:** generated hooks for every Task 4–7 operationId.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **A new school's owner:**
    - `GET` gives `visible: true`, four items all false and `startedAt: null`;
    - after `start`, `startedAt` is set, and a second `start` leaves it unchanged.
  - **Ticking items off.** Filling in the four profile fields ticks `profile`. Uploading a logo ticks `logo`. Creating a year ticks `academicYear`. Adding an address and PIN to the primary campus ticks `campuses`. With all four done, `visible` is false.
  - **Dismissing** gives `visible: false` while items remain.
  - **A Teacher** gets `visible: false`, and `start` gives 403.
  - **Signing out and back in** after `start` keeps `startedAt`. The redirect rule itself is tested in Task 10 (Review Focus 5).
  - **The CLI:** `school:demo-setup` on a fresh school makes every item done.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement, then regenerate the client and run `pnpm typecheck`. **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit `feat(api): add the onboarding checklist and a demo setup command`.

---

### Task 8: Web: school profile and logo

**Files:**

- Create: `apps/web/src/features/school-settings/{profile-form,logo-field,school-errors}.tsx|ts` and `school-errors.test.ts`.
- Create: `apps/web/src/app/[locale]/(app)/settings/school-profile/page.tsx`.
- Modify:
  - `config/nav.ts` (+ test): replace the `schoolProfile` item with `schoolProfile`, `academicYears` and `campuses` at `/settings/…`, each needing `settings.view`. Update `comingSoonSections` so `settings/*` pages aren't placeholders.
  - `messages/en.json`, `a11y.spec.ts`.
  - The sidebar header: show the logo from `logoUrl` when it's set, otherwise the existing mark.

**Interfaces (Produces):**

- **`ProfileForm`:** `ProfileForm({ profile, canEdit, onSaved? }: { profile: SchoolProfile; canEdit: boolean; onSaved?: () => void })`. With `canEdit` false it renders read-only fields.
- **`LogoField`:** `LogoField({ logoUrl, canEdit })`. It checks the type and the 2 MB size on the client, then calls `uploadSchoolLogo` or `removeSchoolLogo`.
- **`schoolProblemMessage`:** `schoolProblemMessage(problem): string` maps every spec §11 type, and each `logo-invalid` reason, to an `en.json` key.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **Unit:** every problem type and logo reason has a message key, and an unknown type falls back to the generic message.
  - **Nav:**
    - a Teacher without `settings.view` sees no Settings group;
    - `settings.view` alone shows all three items.
  - **a11y:** the profile page and the logo field (empty and with a logo), in light and dark.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement. Form fields come from the Task 1 schema, using react-hook-form with the zod resolver. The medium field is an input with a `datalist` of `MEDIUM_SUGGESTIONS`. **Step 4:** Run the unit tests and the a11y spec on desktop-chrome. Expect PASS.
- [ ] **Step 5:** Commit `feat(web): edit the school profile and logo in Settings`.

---

### Task 9: Web: academic years and campuses

**Files:**

- Create: `features/school-settings/{academic-year-form,years-list,campus-form,campuses-list,year-form-helpers}.tsx|ts` and `year-form-helpers.test.ts`.
- Create the pages `settings/academic-years/page.tsx` and `settings/campuses/page.tsx`.
- Modify: `messages/en.json`, `a11y.spec.ts`.

**Interfaces (Produces):**

- **`AcademicYearForm`:** `AcademicYearForm({ initial?, onSaved })`. It has start and end dates, a 2- or 3-term choice and editable term rows. It regenerates `defaultTerms` when the dates or the count change, unless the person has edited a term row, and then it asks before overwriting. It shows the `checkTerms` problem inline on the failing row.
- **`YearsList`:** `YearsList({ years, canEdit })`. It shows a status pill per year, plus:
  - "Prepare next year", which opens the form pre-filled from `nextYearDates` and is hidden while a planned year exists;
  - "Make current", which asks for confirmation and shows the early-start wording of spec §6 when today is before `startsOn`;
  - "Delete" on a planned year.
- **`CampusesList`:** `CampusesList({ campuses, canEdit })`. Cards at `md` and wider, a list below. The actions are Edit, Make primary and Deactivate/Reactivate, and refusals show `schoolProblemMessage`.
- **Helpers:** `year-form-helpers.ts` exports `formStateAfterDateChange(state, change)`, the pure part of the regeneration rule.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **Unit:**
    - Changing the end date with untouched terms regenerates them.
    - With an edited term, it returns `needsConfirm: true` and leaves the terms as they are.
    - Switching from 2 to 3 terms regenerates them.
  - **a11y:**
    - academic years: empty, with a current and a planned year, and the form dialog open;
    - campuses: one campus, two campuses with one inactive, and the edit dialog open.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement. **Step 4:** Run the unit tests and the a11y spec on desktop-chrome. Expect PASS.
- [ ] **Step 5:** Commit `feat(web): manage academic years and campuses in Settings`.

---

### Task 10: Web: wizard, checklist and switchers

**Files:**

- Create:
  - `features/onboarding/{onboarding-wizard,wizard-steps,checklist-card,leave-guard}.tsx`;
  - `apps/web/src/app/[locale]/(app)/onboarding/page.tsx`;
  - `lib/selection-cookies.ts` (+ test);
  - `lib/onboarding-redirect.ts` (+ test).
- Modify:
  - `dashboard/page.tsx` (redirect and checklist card);
  - `academic-year-switcher.tsx` and `campus-switcher.tsx` (real data);
  - `lib/session.ts` (drop the computed `academicYear` and the single-campus shape; the shell fetches years and campuses);
  - `messages/en.json`, `a11y.spec.ts`.

**Interfaces (Produces):**

- **Cookie helpers:**
  - `pickYear(years: AcademicYear[], cookie: string | undefined): AcademicYear | null`: the cookie's year if it's in the list, else the current year, else null.
  - `pickCampus(campuses, cookie)`: the cookie's campus if it's listed and active, else the primary campus.
  - `writeSelection('cl_year' | 'cl_campus', id)`.
- **Redirect rule:** `shouldOpenWizard(input: { canManage: boolean; startedAt: string | null }): boolean`.
- **Hooks:** `useSelectedYear()` and `useSelectedCampus()`, for later modules.

**Steps:**

- [ ] **Step 1: Failing tests.**
  - **`pickYear`:**
    - an unknown cookie id, or one from another school's list, falls back to the current year;
    - no years gives null (Review Focus 4).
  - **`pickCampus`:**
    - an inactive campus's id falls back to the primary campus.
  - **`shouldOpenWizard`:**
    - true only for `canManage && startedAt === null`.
  - **a11y:**
    - each of the 4 wizard steps;
    - the dashboard with the checklist card;
    - the year switcher open with no years and with 2 years;
    - the campus switcher open with 2 campuses.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
  - **Opening the wizard:** the dashboard server component reads `GET /school/onboarding`, and redirects to `/onboarding` when `shouldOpenWizard` says so. The wizard page calls `startOnboarding` on mount.
  - **Steps:** each step embeds the Task 8 and 9 forms. The stepper ticks come from the checklist.
  - **Leaving:** `leave-guard` asks before navigation when the current step's form is dirty.
  - **Sticky actions:** below `md`, use `sticky bottom-0` with a safe-area inset.
- [ ] **Step 4:** Run the unit tests and the a11y spec on desktop-chrome. Expect PASS.
- [ ] **Step 5:** Commit `feat(web): add the setup wizard, checklist and real year and campus switchers`.

---

### Task 11: End to end

**Files:** create `apps/web/e2e/onboarding.spec.ts`, `school-settings.spec.ts` and `docs/superpowers/followups/2026-11-03-onboarding.md` (header only). Modify `e2e/support/school.ts` (helpers: `setUpCurrentYear`, `uploadLogo`).

**Steps:**

- [ ] **Step 1: Write the specs.**
  - **A new owner completes setup.**
    1. Register and sign in; they land on `/onboarding`.
    2. Profile step: fill it in and save.
    3. Logo step: upload a JPEG fixture and see the preview.
    4. Year step: choose 3 terms, keep the defaults and save.
    5. Campuses step: add an address and a second campus.
    6. Finish. The dashboard shows no checklist, the sidebar shows the logo, and both switchers list the new data.
  - **A new owner skips everything.**
    1. Skip all 4 steps; the dashboard shows "0 of 4 done".
    2. Reload: no redirect.
    3. Sign out and back in: still no redirect (Review Focus 5).
    4. Complete the year from Settings: "1 of 4 done".
    5. Dismiss: the card is gone.
  - **Years.** Prepare next year, then make it current with the confirmation. The first year shows Closed and its actions are gone. The year switcher's selection survives a reload.
  - **Campuses.** Add a campus, then deactivate the primary campus: refused with the copy for `campus-primary`. Make the other campus primary, then deactivate the old one. The campus switcher lists only active campuses.
  - **Read-only access.**
    - A Teacher with a custom role that adds `settings.view` sees read-only Settings, with no edit buttons.
    - A plain Teacher has no Settings group, and opening the URL directly shows access denied.
  - **Layout.** No horizontal scroll at 375 px on every wizard step.
- [ ] **Step 2:** Run on desktop-chrome, then on all 6 projects. Expect PASS.
- [ ] **Step 3:** Commit `test(web): cover onboarding and school settings end to end`.
