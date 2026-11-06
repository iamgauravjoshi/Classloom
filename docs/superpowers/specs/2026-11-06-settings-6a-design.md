# Phase 1, Part 6a: number series and the audit-log viewer

Status: draft for review · Date: 2026-11-06 · Builds on: [Part 3: IAM](2026-11-02-iam-design.md), [Part 4: onboarding](2026-11-03-onboarding-design.md), [Part 5: academics](2026-11-04-academics-design.md) · Research: [settings notes](../../research/settings.md)

## 1. Purpose

Phase 2 needs document numbers that are reliable and never reused, starting with admission numbers. Schools also need to see who changed what: Parts 3–5 record an audit trail that nobody can read yet. This part delivers both.

Custom fields and editable email templates are **Part 6b**, scheduled after Phase 2.

### Success criteria

- Every school has four number series (Enquiry, Application, Admission, Fee receipt) with sensible defaults. An admin can change a series' pattern, its reset rule and its next number, and sees a preview.
- Numbers handed out concurrently are unique. A number that has been issued is never issued again.
- A holder of the new `audit.view` permission can browse, filter and expand the school's audit trail, and export it as CSV.
- Every change to a number series is audited.

### Decisions already made (with the user, 2026-11-06)

| Topic        | Decision                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Scope        | 6a = number series and the audit-log viewer. 6b = custom fields and email templates, after Phase 2.                        |
| Numbering    | A pattern with tokens, plus a reset rule per series (each academic year, or never). One series per school, not per campus. |
| Audit access | A new `audit.view` permission. Owner and Admin have it by default. Schools can grant it to other roles.                    |

## 2. Scope

**In scope:**

- the `number_series` and `number_series_counters` tables;
- the pattern rules;
- the allocation service;
- the Settings page for number series;
- the `audit.view` permission and its migration;
- the audit events API with CSV export;
- the audit-log page.

**Out of scope, and where each goes:**

- **Using the series:** the admission, enquiry and application forms (Phase 2) and fee receipts (Phase 5).
- **Custom fields and email templates:** Part 6b.
- **Sign-in history:** it already exists per person (Part 2b).
- **Deleting or archiving audit rows:** not planned. The trail is append-only.

## 3. Number series

### Series and defaults

The keys are fixed, in a `NumberSeriesKey` enum. Rows are seeded for every existing school by the migration, and for new schools at registration.

| Key           | Name        | Default pattern    | Default reset   |
| ------------- | ----------- | ------------------ | --------------- |
| `ENQUIRY`     | Enquiry     | `ENQ/{AY}/{SEQ:4}` | `ACADEMIC_YEAR` |
| `APPLICATION` | Application | `APP/{AY}/{SEQ:4}` | `ACADEMIC_YEAR` |
| `ADMISSION`   | Admission   | `{SEQ:5}`          | `NEVER`         |
| `FEE_RECEIPT` | Fee receipt | `REC/{AY}/{SEQ:5}` | `ACADEMIC_YEAR` |

### Pattern rules

These live in `@classloom/contracts`, so the API and web share them.

- **Tokens:**
  - `{AY}`: the academic year as "2026-27". It uses a hyphen, because some boards and printers don't handle an en dash.
  - `{YYYY}`: the academic year's start year, "2026".
  - `{YY}`: the start year's last two digits, "26".
  - `{SEQ:n}`: the counter, zero-padded to n digits, where n is 1–8. A counter longer than n prints in full, with no padding and no truncation.
- **Literal text:** letters, digits, `/`, `-`, `_` and spaces.
- **Rules:**
  - The whole pattern is 1–40 characters.
  - `{SEQ:n}` appears exactly once.
  - Year tokens are allowed with either reset rule.
- **Example:** `ADM/{YY}/{SEQ:4}` with year 2026-27 and counter 12 gives `ADM/26/0012`.
- **Functions:** `parseNumberPattern(pattern)` returns the parts or the first problem: `empty`, `too-long`, `bad-character`, `unknown-token`, `seq-missing`, `seq-repeated` or `seq-width`. `formatNumber(parts, { yearStart, sequence })` returns the string.

### Data model

All tables are tenant-owned under forced RLS, listed in `TENANT_SCOPED_MODELS`, and have `created_at` and `updated_at`.

**`number_series`:** one row per (school, key).

| Column             | Type | Rules                                                                                 |
| ------------------ | ---- | ------------------------------------------------------------------------------------- |
| `tenant_id`, `key` | PK   | `key` is `NumberSeriesKey`                                                            |
| `pattern`          | text | Passes the pattern rules, enforced by the service; the DB checks only the length 1–40 |
| `reset`            | enum | `ACADEMIC_YEAR`, `NEVER`                                                              |

**`number_series_counters`:** one row per (school, key, period).

| Column                       | Type   | Rules                                                                               |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `tenant_id`, `key`, `period` | PK     | `period` is an academic year id as text for `ACADEMIC_YEAR`, or `'ALL'` for `NEVER` |
| `last_value`                 | bigint | ≥ 0. The last number issued; the next one is `last_value + 1`.                      |

### Allocating numbers

`NumberSeriesService.next(tx, key, academicYear: { id, startsOn }): Promise<{ value: string; sequence: number }>`

- It runs in the caller's transaction:
  1. Read the series row.
  2. Decide the period: the year's id, or `'ALL'`.
  3. Run `INSERT … ON CONFLICT (tenant_id, key, period) DO UPDATE SET last_value = number_series_counters.last_value + 1 RETURNING last_value`. The upsert row lock serialises concurrent callers.
  4. Format the number with the series' current pattern.
- If the caller's transaction rolls back, the counter rolls back too, so a cancelled save never uses up a number.
- Numbers are never reused, because counters only grow.
- A counter outside the 1–99,999,999 range throws a typed `NumberSeriesExhausted` error.

### Changing a series

- **Pattern and reset:** these can change at any time, and apply only to numbers issued afterwards.
  - Switching `NEVER` → `ACADEMIC_YEAR` starts per-year counters at 0, or at the highest number issued so far if the new pattern has no year token, so numbers can't repeat.
  - Switching `ACADEMIC_YEAR` → `NEVER` starts the overall counter at the highest number issued in any year, for the same reason.
- **Setting the next number:** for the current academic year's period (or `'ALL'`), an admin may set `nextNumber`. It must be greater than `last_value`; otherwise the request gets 422 `next-number-too-low` with `{ minimum }`. This lets schools continue from a paper register.
- **Preview:** the page shows the next number for the current year: the formatted string, or "Set up an academic year first" when the school has none.

### API

| Method and path                      | Permission        | Behaviour                                                                                                                                                                                                                      |
| ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /settings/number-series`        | `settings.view`   | The four series, each with pattern, reset, `nextNumber` and `preview` for the current year (null without one)                                                                                                                  |
| `PATCH /settings/number-series/:key` | `settings.manage` | `{ pattern?, reset?, nextNumber? }`. Validates, applies, and writes one audit row, `number_series.updated` (target type `number_series`, target id = tenant id, the key in before and after). Changing nothing writes nothing. |

**Errors:**

- 422 `number-pattern-invalid` with `{ problem }`;
- 422 `next-number-too-low` with `{ minimum }`;
- 404 for an unknown key.

## 4. Audit permission

- **Catalogue:** `IAM_MODULES` gains `audit`, and `PERMISSION_CATALOGUE` gains `{ module: 'audit', actions: ['view'] }`.
- **Built-in role defaults:**
  - Owner keeps "all".
  - Admin gets `audit.view`, because Admin's defaults are every permission.
  - Principal's defaults explicitly exclude `audit.view` (and still exclude `iam.manage` and `settings.manage`).
  - Other built-in roles don't get it.
- **Migration:** inserts `audit.view` for every school's built-in `ADMIN` role, idempotently.
- **Navigation and labels:** the role editor's grid shows the new module through its catalogue labels, which the web `en.json` must add.

## 5. Audit-log viewer

### API

`GET /audit/events` (needs `audit.view`).

- **Query parameters:**
  - `from` and `to` (dates in IST, inclusive);
  - `actorUserId`;
  - `area`: one of `people`, `school`, `calendar`, `academics` or `settings`;
  - `cursor`;
  - `limit` (default 50, maximum 100).
- **Areas** map to fixed lists of action prefixes in `@classloom/contracts`, as `AUDIT_AREAS`:
  - `people`: `role.`, `member.`;
  - `school`: `school.`;
  - `calendar`: `academic_year.`, `campus.`;
  - `academics`: `section.`, `sections.`, `stream.`, `subject.`, `subjects.`, `class_subjects.`, `house.`, `room.`;
  - `settings`: `number_series.`, `audit.`.
- **Order:** newest first, by `(created_at, id)`. The cursor is opaque.
- **Each event:**
  - `id`, `action`, `area`;
  - `createdAt`;
  - `actor`: `{ userId, name } | null`, where null shows as "System";
  - `target`: `{ type, id, label }`, where `label` is looked up at read time (role name, member name, section label, year label…) or null when the target is gone;
  - `changes`: `[{ field, before, after }]`, built from the stored before and after;
  - `ip`;
  - `device`: a short browser/OS string from the stored user agent.
- **Export:** `GET /audit/events.csv`, with the same filters and permission. Up to 5,000 rows; beyond that, 422 `export-too-large` with `{ limit }` asks for a narrower filter. Each export writes one audit row, `audit.exported`, with the filter in `after`.
- **Scope:** everything runs under the school's RLS. Actor names come only from this school's memberships.

### Web

The page is `/[locale]/settings/audit-log`. Its nav item, "Audit log", sits in the Settings group and needs `audit.view`.

- **Filter bar:**
  - date range (DD/MM/YYYY), defaulting to the last 30 days;
  - a person (the school's members);
  - an area.
  - The filters are kept in the URL.
- **List:**
  - each event is a readable sentence from an `en.json` template per action, for example "Asha Rao updated the permissions of the role Teacher", with the time in IST and the device;
  - an expandable details panel shows a table of field, before and after;
  - "Load more" at the end.
  - Below `md`, the events become cards.
- **Export:** an "Export CSV" button downloads the current filter. A refusal for too many rows is explained.
- **Empty state:** "Nothing recorded for these filters".

## 6. Number series page

The page is `/[locale]/settings/number-series` (`settings.view`; editing needs `settings.manage`).

- There's one card per series showing:
  - its name;
  - the pattern, as an input with a token helper;
  - the reset rule;
  - the next number, as an input whose minimum is the current value plus one;
  - a live preview, computed on the client with `formatNumber`.
- Save is per card. Errors appear beside their fields.

## 7. Errors and edge cases

| Situation                                                                                   | Response                                                               |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Pattern fails the rules                                                                     | 422 `number-pattern-invalid` with `{ problem }`                        |
| Next number not above the last issued                                                       | 422 `next-number-too-low` with `{ minimum }`                           |
| A school with no academic year asks for a preview, or a caller asks `next()` without a year | Preview null; `next()` requires a year (a programming error otherwise) |
| Two callers allocate at once                                                                | The upsert lock serialises them, giving unique consecutive numbers     |
| The caller's transaction rolls back after allocating                                        | The counter rolls back; the number is reissued                         |
| CSV for more than 5,000 rows                                                                | 422 `export-too-large` with `{ limit }`                                |
| An audit target has since been deleted                                                      | `label: null`; the sentence uses "a deleted …"                         |
| A member without `audit.view` opens the page or the API                                     | Access denied; 403 `permission-denied`                                 |

## 8. Migration

1. Create the `NumberSeriesKey` and `NumberSeriesReset` enums and the two tables, with RLS policies and grants.
2. Seed the four default series for every school, and change registration to seed them for new schools.
3. Insert the `audit.view` role permission for every school's built-in `ADMIN` role.
4. Widen the audit CHECK with `number_series.updated` and `audit.exported`, and the target types `number_series` and `audit`.

## 9. Testing

- **Unit tests:**
  - `parseNumberPattern` covers every problem and every token;
  - `formatNumber` covers padding, overflow beyond n digits, and year tokens;
  - the area-to-prefix mapping;
  - the device-string parser;
  - the audit sentence keys exist for every audit action.
- **Integration tests (Testcontainers):**
  - 20 concurrent `next()` calls give 20 unique, consecutive numbers;
  - a rollback reissues the same number;
  - `ACADEMIC_YEAR` versus `NEVER`, including reset-rule switches that never repeat numbers;
  - `nextNumber` raises and is refused when too low;
  - default series exist for new and migrated schools;
  - cross-school isolation for the series and the audit events;
  - audit filters, the cursor and CSV, including the 5,000 limit;
  - `audit.exported` is written;
  - `audit.view` is required, the migration grants it to Admin and not to Principal, and Principal's defaults exclude it.
- **E2E on all device projects, with axe in light and dark:**
  - edit the Admission series and see the preview;
  - the next number is refused when too low;
  - browse, filter, expand and export the audit log;
  - a Teacher without `audit.view` sees no nav item and gets access denied;
  - no horizontal scroll at 375 px.

## 10. Acceptance checklist

- [ ] Migrations apply cleanly on a fresh database and on Part 5 data.
- [ ] Unit, integration and E2E tests pass on all six device projects with no axe violations, in both themes.
- [ ] Permissions are enforced in the API and reflected in the UI.
- [ ] Every change writes an audit event.
- [ ] All copy is in i18n files.
