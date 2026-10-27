# Phase 1, Part 1: Tenancy

Status: draft for review · Date: 2026-10-26 · Builds on: [master design](2026-10-25-classloom-master-design.md) (section 3, "Multi-tenancy"), [Phase 0](../plans/2026-10-25-phase-0-foundation.md) · Research: [tenancy notes](../../research/tenancy.md)

## 1. Purpose

Classloom hosts many schools on one deployment. This part creates the foundation every later module builds on:

1. A school can **register itself**, verify its email, and receive a **school code** and a **main campus**.
2. **No school can ever see or change another school's data**: not through the API, not through a coding mistake, and not through a raw database query.

### Success criteria

- A visitor registers a school on a phone or desktop, receives a verification email, clicks it, and sees the school's code.
- An unverified registration disappears after 48 hours and its code becomes free again.
- Automated tests prove cross-school isolation at three levels: API, data-access layer, and raw SQL (row-level security).
- The platform owner can list, suspend and reactivate schools from the command line.

### Decisions already made (with the user, 2026-10-26)

| Topic               | Decision                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Who creates schools | Schools register themselves                                                                   |
| Multi-campus groups | One school account (tenant) with many campuses inside                                         |
| School code         | Short code chosen at registration, suggested from the name                                    |
| Paid services       | None (see the master design's "Free-tier scope"): email only, no domain, so no subdomains yet |

## 2. Scope

**In scope**

- Tenant, Campus, User and Membership data model.
- Data isolation: tenant context, automatic query scoping, Postgres row-level security (RLS) and a restricted database role.
- School code rules, suggestion and availability check.
- Public self-registration (3 steps), email verification, resend, expiry and clean-up.
- Minimal email service (SMTP) with plain templates.
- Rate limiting on public registration endpoints.
- Command-line tools for the platform owner.

**Out of scope** (later parts)

- Signing in, passwords, OTP, sessions: **Part 2 (Auth)**. Until then a verified school exists but its admin cannot sign in yet.
- Platform admin web screen, roles and permissions: **Part 3 (IAM)**.
- Full school profile, branding, more campuses, academic year: **Part 4 (onboarding wizard)**.
- Billing, plans and usage limits; subdomains; CAPTCHA (added only if abuse appears).

## 3. Concepts

| Term            | Meaning                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Tenant**      | One school account: a single school or a trust running several branches. The unit of data isolation.                         |
| **Campus**      | A physical school/branch inside a tenant. Every tenant has exactly one primary campus from registration.                     |
| **User**        | A person, identified globally by email. One user can belong to several tenants (e.g. a parent with children in two schools). |
| **Membership**  | Links a user to a tenant with a role. Part 1 only creates the `OWNER` membership; Part 3 adds the full role set.             |
| **School code** | The tenant's short public identifier, typed at sign-in and printed on letters (e.g. `GISD`).                                 |

## 4. Data model

All tables use UUIDv7 primary keys and `created_at`/`updated_at` timestamps (`timestamptz`). Prisma schema file: `apps/api/prisma/schema/tenancy.prisma`.

### Tenant (`tenants`), platform-level, not row-level secured

| Column              | Type                | Rules                                                     |
| ------------------- | ------------------- | --------------------------------------------------------- |
| `id`                | uuid                | PK                                                        |
| `code`              | citext              | Unique, case-insensitive; stored uppercase; see section 6 |
| `name`              | text                | 3–120 chars (e.g. "Global International School")          |
| `board`             | enum `Board`        | `CBSE`, `ICSE`, `STATE`, `IB`, `CAMBRIDGE`, `OTHER`       |
| `city`              | text                | 2–60 chars                                                |
| `state`             | enum `IndianState`  | 28 states + 8 union territories                           |
| `contact_email`     | citext              | The registering admin's email                             |
| `status`            | enum `TenantStatus` | `PENDING_VERIFICATION`, `ACTIVE`, `SUSPENDED`, `CLOSED`   |
| `verified_at`       | timestamptz?        | Set on verification                                       |
| `suspended_at`      | timestamptz?        | Set when suspended                                        |
| `terms_accepted_at` | timestamptz         | When the registrant accepted terms and data consent       |

### Campus (`campuses`), tenant-owned, row-level secured

| Column          | Type                | Rules                                                |
| --------------- | ------------------- | ---------------------------------------------------- |
| `id`            | uuid                | PK                                                   |
| `tenant_id`     | uuid                | FK → tenants, `ON DELETE CASCADE`                    |
| `name`          | text                | Defaults to the school name at registration          |
| `is_primary`    | boolean             | Exactly one `true` per tenant (partial unique index) |
| `city`, `state` | as tenant           | Copied from registration                             |
| `status`        | enum `CampusStatus` | `ACTIVE`, `INACTIVE`                                 |

### User (`users`), global identity, not row-level secured

| Column              | Type         | Rules                                                             |
| ------------------- | ------------ | ----------------------------------------------------------------- |
| `id`                | uuid         | PK                                                                |
| `email`             | citext       | Unique; normalised with `parseIdentifier` from `@classloom/utils` |
| `name`              | text         | 2–80 chars                                                        |
| `mobile`            | text?        | Optional; E.164 via `normalizeIndianMobile`                       |
| `email_verified_at` | timestamptz? | Set on verification                                               |

Part 2 adds password and session columns; nothing in Part 1 depends on them.

### Membership (`memberships`), tenant-owned, row-level secured

| Column      | Type                  | Rules                                   |
| ----------- | --------------------- | --------------------------------------- |
| `id`        | uuid                  | PK                                      |
| `tenant_id` | uuid                  | FK → tenants, cascade                   |
| `user_id`   | uuid                  | FK → users, cascade                     |
| `role`      | enum `MembershipRole` | Part 1: `OWNER` only; Part 3 extends it |
| `status`    | enum                  | `ACTIVE`, `REVOKED`                     |
|             |                       | Unique `(tenant_id, user_id)`           |

### Registration token (`registration_tokens`), platform-level

| Column       | Type         | Rules                                                                          |
| ------------ | ------------ | ------------------------------------------------------------------------------ |
| `id`         | uuid         | PK                                                                             |
| `tenant_id`  | uuid         | FK → tenants, cascade                                                          |
| `token_hash` | bytea        | SHA-256 of a 32-byte random token; the raw token exists only in the email link |
| `expires_at` | timestamptz  | Issued + 24 hours                                                              |
| `used_at`    | timestamptz? | Single use                                                                     |

Issuing a new token (resend) invalidates earlier unused tokens for that tenant. A token never outlives its registration: `expires_at` is capped at the tenant's purge time (`created_at` + `PENDING_TENANT_TTL_HOURS`), so the expiry stated in the email is always true.

## 5. Data isolation

Isolation is enforced in three layers, so a failure in one is caught by the next.

1. **Tenant context.** A request-scoped `TenantContext` (Node `AsyncLocalStorage`) holds the current tenant ID. Public registration endpoints run without a tenant. From Part 2 on, the tenant comes from the signed-in membership. Code that reads tenant-owned data without a context throws `TenantContextMissingError` (a 500, logged); it never falls back to "all tenants".
2. **Automatic query scoping.** A Prisma client extension adds `tenant_id = <current>` to every read, update and delete on tenant-owned models, and sets `tenant_id` on every create. Tenant-owned models are listed in one registry (`TENANT_SCOPED_MODELS`); a unit test fails if a Prisma model has a `tenantId` field but is missing from the registry.
3. **Row-level security in Postgres.**
   - Every tenant-owned table has RLS enabled and **forced** with the policy `tenant_id = current_setting('app.tenant_id')::uuid`, for `USING` and `WITH CHECK`.
   - Each scoped transaction runs `set_config('app.tenant_id', <id>, true)` (transaction-local), so a pooled connection can never leak a tenant to the next request.
   - **Two database roles:**
     - `classloom_owner` owns the schema and runs migrations.
     - `classloom_app` is used by the API at runtime. It has no `BYPASSRLS` and cannot alter tables, so even a raw `SELECT * FROM campuses` from the app sees only the current tenant's rows.
   - Platform-level tables (`tenants`, `users`, `registration_tokens`) are not row-level secured; only the tenancy and registration services touch them.
   - Local docker and CI create both roles. `DATABASE_URL` uses the app role; a new `DATABASE_MIGRATION_URL` uses the owner role.
   - **The API process never holds the owner credential.** Work that must see across tenants (the expiry purge and registration cancel) runs through owner-defined `SECURITY DEFINER` SQL functions with a pinned `search_path`, executable only by `classloom_app`. `DATABASE_MIGRATION_URL` is optional for the API and required only by migrations and the platform CLI.

## 6. School code rules

- Pattern: `^[A-Z][A-Z0-9-]{1,10}[A-Z0-9]$` **and** no `--`: 3–12 characters of letters, digits and hyphens, starting with a letter, not ending with a hyphen. Input is trimmed and uppercased before validation.

- Unique across all tenants, case-insensitive. Codes held by `PENDING_VERIFICATION` tenants count as taken until they expire.
- **Reserved codes** (rejected so codes stay safe as future subdomains): `ADMIN`, `API`, `APP`, `WWW`, `MAIL`, `CLASSLOOM`, `SUPPORT`, `HELP`, `STATUS`, `DOCS`, `BLOG`, `STATIC`, `ASSETS`, `CDN`, `TEST`, `DEMO`, `ROOT`, `SYSTEM`.
- **Suggestion** (`suggestSchoolCode(name, city)` in `@classloom/utils`):
  1. Take the initials of the name's significant words; skip only the joining words "of", "the", "and" and "&" (school, academy, vidyalaya etc. count, e.g. "Kendriya Vidyalaya" → KV).
  2. Append the first letter of the city ("Global International School", "Dehradun" → `GISD`).
  3. If shorter than 3 characters, insert further letters of the first word after its initial ("Academy", "Pune" → `ACP`). Only ASCII letters A–Z are used. If the name gives none, use the first 3 letters of the city, and finally `SCH`.
  4. If the code is taken, the API tries `-2`, `-3`, … and returns the first free one.
- A code can be changed only by the platform owner (CLI) in Part 1, because it is printed on letters and used at sign-in.

## 7. Self-registration flow

### Web: `/[locale]/register-school` (public, outside the app shell)

A three-step form on one page, following the Figma sign-up screens' layout: brand panel on desktop, single column on phones.

| Step            | Fields                                                                                                                                           | Validation                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1. School       | School name, board (select), city, state (select, Indian states and UTs)                                                                         | Required; lengths per section 4                              |
| 2. School code  | Code input pre-filled with the suggestion, live availability as you type (debounced 400 ms): "Available" / "Taken: try GISD-2" / rule errors     | Section 6 rules                                              |
| 3. Your details | Full name, email, mobile (optional), checkbox "I accept the Terms and allow Classloom to process school data as described in the Privacy Notice" | Valid email; mobile via `parseIdentifier`; checkbox required |

- **Submit:** the page shows "Check your inbox. We sent a verification link to a…@example.com. It expires in 24 hours." with a "Resend link" button (disabled for 60 seconds after each send).
- **Data entry:** the form keeps its state between steps. Back/next never lose input. The browser's back button returns to the previous step.
- **i18n:** all copy lives in `messages/en.json`. Terms and Privacy pages are placeholders in Part 1, linked but with "draft" content.

### API

| Method & path                                            | Body / params                                                                          | Success                                                                                    | Errors                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `GET /schools/code-availability?code=GISD&name=…&city=…` | `code` optional; `name`/`city` for a suggestion                                        | `200 { code, available, reason?, suggestion? }`; `reason` ∈ `taken`, `reserved`, `invalid` | `400` bad params                                                                                         |
| `POST /school-registrations`                             | school name, board, city, state, code, admin name, email, mobile?, `acceptTerms: true` | `202 { maskedEmail, cancelToken }`                                                         | `400` validation (field `errors[]`), `409` code taken (`errors: [{ path: 'code' }]`), `429` rate limited |
| `POST /school-registrations/resend`                      | `{ email, code }`                                                                      | `202` always (no information leak)                                                         | `429`                                                                                                    |
| `POST /school-registrations/cancel`                      | `{ cancelToken }`                                                                      | `204` always (no information leak)                                                         | `429`                                                                                                    |
| `POST /school-registrations/verify`                      | `{ token }`                                                                            | `200 { code, name }`                                                                       | `410 Gone` when expired, used or unknown (one response for all three)                                    |
| `GET /schools/:code/public`                              | none                                                                                   | `200 { code, name, city, state }` for `ACTIVE` schools                                     | `404` for unknown, pending, suspended or closed                                                          |

- **Registration in one transaction:**
  1. Create the tenant (`PENDING_VERIFICATION`).
  2. Create the primary campus.
  3. Upsert the user by email.
  4. Create the `OWNER` membership.
  5. Create the registration token.
  6. Enqueue the verification email.

  If the email cannot be queued, the transaction rolls back.

- **Existing emails:** the same email may register at most **3 pending schools** at once. Beyond that the request returns `202` without creating anything and logs a warning (no enumeration).
- **Verification**, in one transaction:
  - The tenant becomes `ACTIVE` and `verified_at` is set.
  - The user's `email_verified_at` is set if empty.
  - The token is marked used.
  - A second click on a used link returns `410`. The web page then shows "This link was already used. If you registered this school, it's ready; sign-in arrives soon."
- **Expiry clean-up:** a repeatable BullMQ job runs every hour and deletes tenants still `PENDING_VERIFICATION` 48 hours after creation. Campuses, memberships and tokens cascade. Users with no remaining memberships and no verified email are deleted. The job is idempotent and logs counts.
- **Cancel ("Use a different email"):** the `202` carries an opaque `cancelToken` (32 random bytes; only its SHA-256 is stored). The registering browser keeps it in memory only. Cancel deletes the school only while it is still `PENDING_VERIFICATION`, freeing its code, so a mistyped address can be corrected without the wrong recipient becoming the owner. Verification clears the cancel hash.
- **Queue outages:** job producers fail fast when Redis is unreachable (no offline queue, ~2 s backstop), so registration returns an error and rolls back instead of hanging.
- **Rate limits** (`@nestjs/throttler` with Redis storage, per client IP unless noted):
  - `POST /school-registrations`: 5 per hour (`REGISTRATION_RATE_LIMIT_PER_HOUR`).
  - `/resend` and `/cancel`: 10 per hour per IP (`RESEND_RATE_LIMIT_PER_HOUR`); resend is also limited to 3 per hour per email+code.
  - `/code-availability`: 60 per minute (`CODE_AVAILABILITY_RATE_LIMIT_PER_MINUTE`).

  Limits come from env vars so tests can lower them.

### Verification page: `/[locale]/register-school/verify?token=…`

- Calls the verify endpoint once on load and shows one of three states:
  - **Success:** "Global International School is ready. School code: **GISD**", with a copy button, plus a note that sign-in is coming in the next release.
  - **Already used / expired:** a friendly message with a "Request a new link" form (email + code).
  - **Network error:** a retry button.
- The token is removed from the address bar after reading (`history.replaceState`), so it doesn't stay in browser history.

## 8. Public school lookup

`GET /schools/:code/public` lets the sign-in page (Part 2) show "Signing in to Global International School, Dehradun" after a code is typed. It returns only public fields. Codes of non-active schools return `404`, so a suspended school's existence isn't confirmed.

## 9. Email

- **`EmailModule`** in `apps/api/src/core/email/`:
  - An `EmailSender` interface with one SMTP implementation (nodemailer).
  - Configured by `SMTP_URL` and `EMAIL_FROM` (e.g. `"Classloom <no-reply@classloom.local>"`).
  - Locally SMTP points at Mailpit; deployed, at a free relay (Brevo or Gmail).
- **Delivery:** emails are sent from a BullMQ job (`email` queue) with 5 retries and exponential backoff, so a slow SMTP server never blocks a request.
- **Templates** are TypeScript functions returning `{ subject, html, text }`, with copy in an API-side `messages/en.json`.
  - Part 1 has one template: **Verify your school registration.** It contains the school name, code, verify button and link, expiry time, and the line "If you didn't register, ignore this email".
  - The HTML is table-based and inline-styled for email clients, uses the brand primary `#3D5EE1`, and always comes with a plain-text part.
- **Links** are built from `WEB_ORIGIN`: `${WEB_ORIGIN}/en/register-school/verify?token=…`.

## 10. Platform owner tools (CLI)

Run with `pnpm --filter @classloom/api cli <command>` against the configured database, using the owner role.

| Command                               | Effect                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| `schools:list [--status ACTIVE]`      | Table of code, name, city, status, created date, owner email                         |
| `schools:suspend <code> --reason "…"` | Sets `SUSPENDED`; public lookup returns 404; from Part 2, sign-in is refused         |
| `schools:activate <code>`             | Sets `ACTIVE` again (also works for a pending school, e.g. when email never arrived) |
| `schools:rename-code <old> <new>`     | Applies section 6 rules                                                              |

Every command writes a structured log line: who ran it (OS user), what changed, before/after. The audit log table arrives in Part 6, and these commands will write to it then.

## 11. Errors and edge cases

| Situation                                                         | Behaviour                                                                                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Two people submit the same code at the same moment                | Unique index decides; the loser gets `409` with a fresh suggestion                                                     |
| Code typed in lowercase                                           | Accepted; stored uppercase                                                                                             |
| Email with capitals/spaces                                        | Normalised to trimmed lowercase before lookup                                                                          |
| Verification link clicked after 24 h but before the 48 h clean-up | `410`; the page offers "Request a new link", which issues a new token                                                  |
| Link clicked after the 48 h clean-up                              | `410`; registering again is possible because the code is free                                                          |
| SMTP down                                                         | Request still succeeds (job retries); after 5 failures the job is logged as failed and the registrant can use "Resend" |
| Tenant context missing in a tenant-scoped query                   | `TenantContextMissingError` → 500 with no internals (problem+json), logged with the route                              |
| Suspended school                                                  | Hidden from public lookup; CLI shows it; no other effect until Part 2                                                  |

All API errors use the existing RFC 7807 format (`application/problem+json`) with field `errors[]` for validation.

## 12. Configuration changes

New env vars (validated by `parseEnv`, documented in `.env.example`):

- `DATABASE_MIGRATION_URL` (owner role).
- `EMAIL_FROM`.
- `REGISTRATION_RATE_LIMIT_PER_HOUR` (default 5).
- `REGISTRATION_TOKEN_TTL_HOURS` (default 24).
- `PENDING_TENANT_TTL_HOURS` (default 48).

`SMTP_URL` already exists. Docker Compose gains an init script that creates the two database roles.

## 13. Testing

| Level                                                   | What it proves                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (`@classloom/utils`)                               | Code validation (valid, too short, too long, leading digit, trailing/double hyphen, reserved, lowercase input); `suggestSchoolCode` for typical Indian school names, including single-word names, names of only filler words, and non-ASCII characters (transliterated or skipped)                                                                                            |
| Unit (API)                                              | Prisma extension adds tenant filters to find/update/delete/create; `TENANT_SCOPED_MODELS` covers every model with `tenantId`; masked email formatting                                                                                                                                                                                                                         |
| Integration (Testcontainers Postgres + Redis + Mailpit) | Registration creates tenant/campus/user/membership/token atomically; email lands in Mailpit with a working link; verify activates; used/expired/unknown tokens return 410; resend invalidates old tokens; 4th pending school for one email creates nothing; code race returns 409; clean-up job deletes expired pending tenants and orphan users only; rate limits return 429 |
| Integration: isolation                                  | With tenants A and B: (1) API-level reads for A never return B's campuses; (2) the Prisma client in A's context cannot update/delete B's rows (0 rows affected); (3) **raw SQL** as `classloom_app` with `app.tenant_id = A` sees no B rows, and inserting a row with B's `tenant_id` fails RLS `WITH CHECK`; (4) without `app.tenant_id` set, raw selects return no rows     |
| E2E (6 device projects + axe, light/dark)               | Register a school end-to-end: fill 3 steps, check live code availability, submit, read the email from Mailpit's API, open the link, see the code; taken-code error; expired-link page; keyboard-only completion of the form on desktop; no horizontal overflow at 375 px                                                                                                      |

## 14. Acceptance checklist

- [ ] Migrations create the tables, enums, indexes, RLS policies and roles; `prisma migrate deploy` runs clean on an empty database.
- [ ] A school registers, verifies and shows its code on every device project.
- [ ] Isolation tests pass at API, client and raw-SQL levels.
- [ ] Pending schools expire after 48 hours and free their codes.
- [ ] CLI commands work against a local database.
- [ ] All copy is in i18n files; axe reports no WCAG 2.1 AA violations on the registration and verification pages.
- [ ] CI (lint, typecheck, unit, build, integration, E2E) is green.
