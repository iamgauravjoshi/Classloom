# Phase 1, Part 4: school onboarding (profile, logo, academic years, campuses)

Status: draft for review · Date: 2026-11-03 · Builds on: [Part 1: Tenancy](2026-10-26-tenancy-design.md), [Part 3: IAM](2026-11-02-iam-design.md) · Research: [onboarding notes](../../research/onboarding.md)

## 1. Purpose

After registration a school has a name, a board, a city and one campus. Nothing else is known about it. This part walks the owner through filling in the school's real details. Every later module reads from that data:

- receipts and certificates print the school profile and logo;
- attendance, fees and exams hang off the academic year and its terms;
- the campus switcher lists real branches.

### Success criteria

- A new owner's first sign-in opens a four-step setup wizard. Every step can be skipped.
- A "Finish setting up your school" checklist on the dashboard shows what's still missing, and ticks items off from the saved data.
- The school profile, logo, academic years and campuses can all be edited later under Settings, using the same forms as the wizard.
- A school always has at most one current academic year. Its years never overlap, and its terms cover the year exactly.
- The top-bar year switcher and the sidebar campus switcher show real data.
- An uploaded logo is checked and re-encoded by the server. SVG and oversized files are refused.
- Every change is recorded in the audit trail.

### Decisions already made (with the user, 2026-11-03)

| Topic           | Decision                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wizard          | Opens on first sign-in. Every step can be skipped, and a dashboard checklist remains until setup is done. Everything stays editable in Settings. |
| Logo            | In scope, with a shared file-storage module (RustFS locally, any S3-compatible store later). Logo only, no other brand assets.                   |
| Years and terms | April–March by default with editable dates; 2 or 3 terms; one current year; the next year can be prepared early.                                 |
| Campuses        | Add, edit, deactivate and reactivate; working campus switcher. Members aren't limited to campuses yet (that comes with Staff/HR).                |

## 2. Scope

**In scope:**

- the school profile;
- the logo upload and the core `files` module;
- academic years and terms;
- campus management;
- the onboarding checklist and wizard;
- Settings pages for profile, academic years and campuses;
- real data in the year and campus switchers;
- audit entries for all of the above.

**Out of scope, and where each goes:**

- **Classes, sections and subjects:** Part 5 (academic structure).
- **Prefixes, custom fields and the audit-log viewer:** Part 6 (settings framework).
- **Limiting members to campuses:** Phase 3 (Staff/HR).
- **Filtering lists by the selected year or campus:** each later module, when it has data to filter.
- **Governance, compliance expiry dates and stored documents:** a later documents part.
- **Brand colours, logo variants, draft and publish:** not planned.

## 3. Concepts

| Term            | Meaning                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| School profile  | The school's canonical details: identity, codes, contact and address. One per school.                                |
| Academic year   | A dated period, normally 1 April – 31 March, labelled like "2026–27". Status is `PLANNED`, `CURRENT` or `CLOSED`.    |
| Term            | One of the 2 or 3 consecutive parts of a year. Together the terms cover the whole year.                              |
| Campus          | A branch of the school (it already exists from Part 1). Exactly one is primary.                                      |
| Setup checklist | Four items computed from saved data. It is shown to `settings.manage` holders until all are done or it is dismissed. |

## 4. Data model

All new tables are tenant-owned and have forced row-level security, like every other tenant table. They are added to the tenant-table registry, so the existing registry test covers them. Each table has `created_at` and `updated_at` timestamps.

### School profile (`school_profiles`)

The school's name and board stay on `tenants` (registration and the platform directory use them). The profile endpoint updates both tables in one transaction.

| Column                           | Type               | Rules                                                                              |
| -------------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `tenant_id`                      | uuid, PK           | One row per school. Created for every school by the migration and at registration. |
| `legal_name`                     | text?              | The trust or society name, up to 150 characters                                    |
| `short_name`                     | text?              | Up to 12 characters, e.g. "DPS-D"                                                  |
| `established_year`               | smallint?          | 1800 to the current year                                                           |
| `udise_code`                     | char(11)?          | 11 digits; the first two must be a valid UDISE+ state code (01–38)                 |
| `affiliation_number`             | text?              | Up to 30 characters: letters, digits, `/` and `-`                                  |
| `school_type`                    | enum?              | `CO_ED`, `BOYS`, `GIRLS`                                                           |
| `residential`                    | enum?              | `DAY`, `BOARDING`, `DAY_AND_BOARDING`                                              |
| `medium`                         | text?              | Up to 40 characters. The form suggests English, Hindi and the regional languages.  |
| `lowest_class`, `highest_class`  | enum `ClassLevel`? | `NURSERY`, `LKG`, `UKG`, `I` … `XII`; lowest ≤ highest                             |
| `phone`                          | text?              | An Indian phone number in E.164 form (+91…), checked by `@classloom/utils`         |
| `email`                          | citext?            | The school's public email (can differ from the registration contact)               |
| `website`                        | text?              | An `https://` URL, up to 200 characters                                            |
| `address_line1`, `address_line2` | text?              | Up to 120 characters each                                                          |
| `city`, `district`               | text?              | Up to 60 characters. `city` starts as `tenants.city`.                              |
| `state`                          | `IndianState`      | Starts as `tenants.state`                                                          |
| `pin_code`                       | char(6)?           | 6 digits, not starting with 0                                                      |
| `logo_file_id`                   | uuid?              | FK to `files`                                                                      |
| `onboarding_started_at`          | timestamptz?       | Set when the wizard first opens (see §9)                                           |
| `onboarding_dismissed_at`        | timestamptz?       | Set when the checklist is dismissed                                                |

Saving `city` or `state` also updates `tenants.city` and `tenants.state`, so the platform directory stays in step.

### File (`files`)

| Column                         | Type  | Rules                                                                    |
| ------------------------------ | ----- | ------------------------------------------------------------------------ |
| `id`, `tenant_id`              | uuid  |                                                                          |
| `purpose`                      | enum  | `SCHOOL_LOGO` (later modules add their own purposes)                     |
| `storage_key`                  | text  | `tenants/<tenantId>/<purpose>/<fileId>.png`, never taken from user input |
| `content_type`                 | text  | What was stored, not what was uploaded                                   |
| `byte_size`, `width`, `height` | int   |                                                                          |
| `sha256`                       | bytea | Of the stored bytes                                                      |
| `created_by_user_id`           | uuid? |                                                                          |

### Academic year (`academic_years`)

| Column                 | Type | Rules                                                                                                     |
| ---------------------- | ---- | --------------------------------------------------------------------------------------------------------- |
| `id`, `tenant_id`      | uuid |                                                                                                           |
| `label`                | text | Up to 20 characters. It defaults to "YYYY–YY" from the dates and is unique per school (case-insensitive). |
| `starts_on`, `ends_on` | date | `ends_on > starts_on`; length between 180 and 400 days                                                    |
| `status`               | enum | `PLANNED`, `CURRENT`, `CLOSED`                                                                            |

Database constraints:

- **No overlapping years:** `EXCLUDE USING gist (tenant_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)`. This needs the `btree_gist` extension, which the migration creates.
- **One current year:** a partial unique index on `(tenant_id) WHERE status = 'CURRENT'`.
- **One planned year:** a partial unique index on `(tenant_id) WHERE status = 'PLANNED'`. Only the next year can be prepared.

### Term (`academic_terms`)

| Column                 | Type     | Rules                                                         |
| ---------------------- | -------- | ------------------------------------------------------------- |
| `id`, `tenant_id`      | uuid     |                                                               |
| `academic_year_id`     | uuid     | FK, cascades on delete                                        |
| `seq`                  | smallint | 1–3; unique per year                                          |
| `name`                 | text     | Up to 40 characters; defaults to "Term 1", "Term 2", "Term 3" |
| `starts_on`, `ends_on` | date     | `ends_on ≥ starts_on`                                         |

**Tiling rule** (checked by the service and by a pure function in `@classloom/contracts`):

- a year has 2 or 3 terms;
- term 1 starts on the year's start date;
- each later term starts the day after the previous one ends;
- the last term ends on the year's end date.

The year and its terms are always written together in one transaction.

**Default term dates:**

- For an April–March year:
  - 2 terms: April–September and October–March.
  - 3 terms: April–July, August–November and December–March.
- For any other year: the months are split as evenly as possible, and the earlier terms take the extra month.

### Campus (`campuses`): changes

| New column                       | Rules                                   |
| -------------------------------- | --------------------------------------- |
| `address_line1`, `address_line2` | Optional, up to 120 characters each     |
| `district`                       | Optional, up to 60 characters           |
| `pin_code`                       | Optional, the same rule as the profile  |
| `phone`, `email`                 | Optional, the same rules as the profile |

A partial unique index on `(tenant_id) WHERE is_primary` keeps exactly one primary campus. The name is unique per school, case-insensitive.

### Audit

`audit_events` gains:

- **Actions:**
  - `school.profile_updated`, `school.logo_changed`, `school.logo_removed`;
  - `academic_year.created`, `academic_year.updated`, `academic_year.made_current`, `academic_year.deleted`;
  - `campus.created`, `campus.updated`, `campus.deactivated`, `campus.reactivated`, `campus.made_primary`.
- **Target types:** `school`, `academic_year`, `campus`.

As in Part 3, `before` and `after` hold only the changed fields, and the event is written in the same transaction as the change.

## 5. File storage (`core/files`)

- **Client:** a `FileStorage` interface (`put`, `get`, `delete`) with an S3 implementation (`@aws-sdk/client-s3`), configured from `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` and `S3_FORCE_PATH_STYLE`. Locally it points at the RustFS container. The bucket is private.
- **Setup:** `pnpm infra:up` creates the bucket. The health check reports storage as `degraded` when it can't be reached, not `down`.
- **Image intake** (`ImageIntake`, used by the logo now and by photos later):
  - **Size:** reject anything over 2 MB before decoding.
  - **Format:** decode with sharp, with `limitInputPixels` set to 25 megapixels to stop decompression bombs. Accept only PNG, JPEG or WebP, judged by the decoded format, never by the file name or `Content-Type`. SVG, GIF, HEIC and anything else get 422 `logo-invalid`.
  - **Dimensions:** reject images smaller than 64 px on either side.
  - **Output:** auto-rotate, resize so the longest side is at most 512 px (never enlarging), strip all metadata, and encode as PNG.
- **Logo endpoints:**
  - **Upload:** `PUT /school/logo` takes a multipart upload with a single field, `file`. It stores the object and then, in one transaction, inserts the `files` row, points the profile at it and writes the audit event.
  - **Replacing:** the old object is deleted after the commit. If that delete fails, the leftover object is only logged, never shown to anyone.
  - **Removing:** `DELETE /school/logo` clears the logo.
  - **Rate limit:** 10 uploads per school per hour.
- **Serving:** `GET /school/logo` streams the stored PNG with an `ETag` equal to the file id. Clients ask for `/api/school/logo?v=<fileId>`, and that versioned URL is cached as `private, max-age=31536000, immutable`. With no logo it returns 404.

## 6. Academic years

### API (`/school/academic-years`)

| Method and path                                | Permission        | Behaviour                                                                                                                           |
| ---------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /school/academic-years`                   | any member        | All years, newest first, with their terms                                                                                           |
| `POST /school/academic-years`                  | `settings.manage` | Creates a year with its terms. Its status is `CURRENT` if the school has no current year, otherwise `PLANNED`.                      |
| `PATCH /school/academic-years/:id`             | `settings.manage` | Changes the label, the dates or the terms (sent in full). Refused for a `CLOSED` year.                                              |
| `POST /school/academic-years/:id/make-current` | `settings.manage` | `PLANNED` becomes `CURRENT` and the previous `CURRENT` becomes `CLOSED`, in one transaction under a row lock on the school's years. |
| `DELETE /school/academic-years/:id`            | `settings.manage` | Allowed for a `PLANNED` year only                                                                                                   |

The create and update bodies are `{ label?, startsOn, endsOn, terms: [{ name, startsOn, endsOn }] }`. When `terms` is left out on create, the body must say `termCount: 2 | 3` and the default dates are used.

Rules:

- A closed year never reopens, and a closed year can't be made current again.
- "Make current" is allowed before the planned year's start date. The web asks for confirmation when that's the case ("2027–28 starts on 1 April 2027. Make it current now?").

### Year switcher

- The top-bar switcher lists the school's years with the current one marked. The selection is stored in a cookie, `cl_year`, holding the year id.
- If the cookie is missing, unknown or belongs to another school, the switcher falls back to the current year.
- With no years at all it shows "Set up academic year", linking to Settings (or to the wizard for `settings.manage` holders) and plain text for everyone else.
- The selected year doesn't filter anything yet. Later modules read it through a `useSelectedYear()` hook.

## 7. Campuses

### API (`/school/campuses`)

| Method and path                          | Permission        | Behaviour                                                                      |
| ---------------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| `GET /school/campuses`                   | any member        | Active campuses; with `?status=all` (needs `settings.view`), inactive ones too |
| `POST /school/campuses`                  | `settings.manage` | Adds a campus. At most 20 per school, counting inactive ones.                  |
| `PATCH /school/campuses/:id`             | `settings.manage` | Edits the name, address and contact                                            |
| `POST /school/campuses/:id/make-primary` | `settings.manage` | Moves the primary flag to this campus. It must be active.                      |
| `POST /school/campuses/:id/deactivate`   | `settings.manage` | Refused for the primary campus and for the last active campus                  |
| `POST /school/campuses/:id/reactivate`   | `settings.manage` |                                                                                |

Primary changes and deactivation lock the school's campus rows first (`FOR UPDATE`), the same pattern as Part 3's last-owner rule.

### Campus switcher

- The sidebar header lists the active campuses, with the primary first. The selection is stored in a cookie, `cl_campus`, and falls back to the primary campus.
- `settings.manage` holders also see "Manage campuses", linking to Settings.
- Like the year, the campus selection doesn't filter anything yet.

## 8. School profile

| Method and path       | Permission        | Behaviour                                                                                     |
| --------------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| `GET /school/profile` | any member        | The profile plus `name`, `board`, `code` and `logoUrl` (the versioned URL, or null)           |
| `PUT /school/profile` | `settings.manage` | Replaces the editable fields. Empty strings become null. `name` and `board` update `tenants`. |

Members see the profile's name and logo in the shell, so reading it needs no permission.

## 9. Onboarding checklist and wizard

### Checklist (`GET /school/onboarding`, any member; it returns `visible: false` without `settings.manage`)

| Item           | Done when                                                               |
| -------------- | ----------------------------------------------------------------------- |
| School profile | `udise_code`, `address_line1`, `pin_code` and `phone` are all filled in |
| Logo           | `logo_file_id` is set                                                   |
| Academic year  | A `CURRENT` year exists                                                 |
| Campuses       | The primary campus has `address_line1` and `pin_code`                   |

- The response is `{ visible, items: [{ key, done }], startedAt, dismissedAt }`. `visible` is false when every item is done or the checklist was dismissed.
- `POST /school/onboarding/dismiss` and `POST /school/onboarding/start` (both need `settings.manage`) set the timestamps, and only the first time.
- The dashboard shows the checklist as a card with a progress count ("2 of 4 done"). Each item links to its wizard step, and the card has a "Dismiss" action.

### Wizard (`/[locale]/onboarding`, needs `settings.manage`)

- **When it opens:** on the first visit to `/dashboard`, a `settings.manage` holder is redirected to `/onboarding` if the school's `onboarding_started_at` is null. Opening the wizard calls `start`. It never redirects again, so the checklist card takes over after that. Existing schools get the wizard once after this part is deployed.
- **Steps:**
  1. **Profile**
  2. **Logo**
  3. **Academic year:** pick 2 or 3 terms, check the generated dates and the label.
  4. **Campuses:** the primary campus's address, plus "Add another campus".
- **Layout:**
  - A stepper shows each step's completion from the checklist data.
  - "Save and continue" saves through the normal endpoints. "Skip" moves on without saving.
  - On a phone the step actions stick to the bottom of the screen.
  - "Finish" goes to `/dashboard`.
- **Leaving early:** a step with unsaved edits asks before you leave it.
- **Shared forms:** each step reuses the same form component as its Settings page (`features/school-settings/*`).

## 10. Web

- **Settings pages:**
  - `/[locale]/settings/school-profile`
  - `/[locale]/settings/academic-years`
  - `/[locale]/settings/campuses`
- **Access:** all three need `settings.view`. Edit controls appear only for `settings.manage` holders; without it the forms are read-only.
- **Navigation:** the Settings group lists the three pages, filtered by permission as in Part 3.
- **Pages:**
  - **Academic years:** a list of years, each with its status pill, dates and terms. It offers "Prepare next year", which pre-fills the dates that follow the current year, and "Make current", which asks for confirmation.
  - **Campuses:** a card per campus with a status pill, a primary badge and Edit / Make primary / Deactivate actions. Below `md`, these become a list.
- **Logo field:** a preview with Replace and Remove buttons, client-side checks of type and size (the server still decides), and an error message for every refusal.
- **Copy:** every string is in `en.json`. Dates are shown as DD/MM/YYYY and computed in IST.

## 11. Errors and edge cases

| Situation                                                            | Response                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Years overlap (constraint or pre-check)                              | 409 `academic-year-overlap`                                                         |
| A planned year already exists                                        | 409 `academic-year-planned-exists`                                                  |
| Terms don't tile the year, or the count isn't 2 or 3                 | 422 `academic-terms-invalid`, with the failing term index                           |
| Editing or making current a closed year; deleting a non-planned year | 409 `academic-year-locked`                                                          |
| Label already used                                                   | 409 `academic-year-label-taken`                                                     |
| Deactivating the primary campus                                      | 409 `campus-primary`                                                                |
| Deactivating the last active campus                                  | 409 `campus-last-active`                                                            |
| Campus name already used                                             | 409 `campus-name-taken`                                                             |
| More than 20 campuses                                                | 409 `campus-limit`                                                                  |
| Making an inactive campus primary                                    | 409 `campus-inactive`                                                               |
| Logo of the wrong type, too big, too small or undecodable            | 422 `logo-invalid`, with a `reason` of `type`, `size`, `dimensions` or `decode`     |
| Storage unreachable during upload                                    | 503 `storage-unavailable`; nothing is written                                       |
| Two "make current" requests at once                                  | Serialised by the row lock: one succeeds, the other gets 409 `academic-year-locked` |
| A cookie holds another school's year or campus id                    | Ignored; the switcher falls back to the default                                     |

## 12. Migration

1. Create the `btree_gist` extension, then the new enums and the `files`, `school_profiles`, `academic_years` and `academic_terms` tables with their row-level-security policies and grants. Add the new campus columns and the primary-campus index.
2. Backfill one `school_profiles` row per school, with `city` and `state` copied from `tenants`.
3. Registration creates the profile row from now on.
4. No academic year is created. Each school sets up its own in the wizard.

The migration aborts with a clear message if any school has more or fewer than one primary campus. This should never happen after Part 1.

## 13. Testing

- **Unit tests:**
  - UDISE+, PIN, affiliation and phone validators;
  - default term dates for April and non-April years;
  - the tiling function (gaps, overlaps, wrong count, out of range);
  - year label generation;
  - checklist computation.
- **Image intake:** real fixtures for PNG, JPEG, WebP, SVG, GIF, an over-size file, a too-small image, a truncated file, and a decompression bomb with huge declared dimensions. The tests also check that the output is PNG, at most 512 px, with no metadata.
- **API integration tests (Testcontainers):**
  - the overlap and one-current/one-planned constraints at the database level;
  - concurrent "make current";
  - the primary and last-active campus rules under concurrency;
  - cross-school isolation for every new table;
  - permission refusals (a Teacher can read but not change; `settings.view` without `settings.manage`);
  - audit rows for each action.
- **Logo against real storage:** a MinIO/RustFS Testcontainer covers upload, replace (the old object is deleted), remove, the versioned URL and cache headers, and 503 when storage is down.
- **Migration test:** pre-Part-4 data upgrades with one profile row per school, the city and state copied, and no years.
- **E2E (Playwright, every device project, with axe in light and dark themes):**
  - a new owner is sent to the wizard, completes every step and lands on a dashboard with no checklist;
  - another owner skips everything, sees "0 of 4 done" and finishes a step from Settings;
  - "Prepare next year" then "Make current";
  - adding, deactivating and changing the primary campus;
  - the switchers show the new data;
  - a Teacher sees read-only settings, or none without `settings.view`.

## 14. Acceptance checklist

- [ ] Migrations apply cleanly on a fresh database and on Part 3 data.
- [ ] Unit, integration and E2E tests pass on all six device projects with no axe violations, in both themes.
- [ ] Permissions are enforced in the API and reflected in the UI.
- [ ] Every change writes an audit event.
- [ ] All copy is in i18n files.
- [ ] Seed data shows a school with a profile, a logo, a current year with 3 terms and two campuses.
