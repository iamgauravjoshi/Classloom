# Classloom — Master Plan (School Management SaaS for Indian Schools)

## Context

`E:\Classloom` is an empty greenfield folder (only shadcn/ui agent skills are installed). The goal is a modern, multi-school SaaS ERP that eventually runs an entire Indian school from one portal. UI/UX takes inspiration from **PreSkool** (demo site plus Figma UI kit), but features are adapted to today's Indian schools (CBSE/ICSE/State boards, April–March academic year, UDISE+/APAAR, RTE, UPI fees, SMS/WhatsApp, DPDP Act).

The work is built **module by module**. Each module goes through spec → plan → TDD build → cross-device testing before the next one starts. This document is the master blueprint: vision, stack, repo structure, backend architecture, design tokens, UI structure, roadmap and the per-module workflow.

### Decisions confirmed with you

| Topic                             | Decision                                                                                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business model                    | Multi-school SaaS from day 1 (tenant isolation, subscription plans later). No paid services until there is a paying school (see "Free-tier scope")                                                                      |
| Stack                             | TypeScript monorepo: Next.js (web) + NestJS (API) + PostgreSQL + Redis                                                                                                                                                  |
| Mobile                            | Mobile-first responsive web + installable PWA; native Expo app later on the same API                                                                                                                                    |
| Login                             | One identifier field (email **or** mobile). **OTP is sent by email only** for now; mobile numbers sign in with a password. SMS OTP is added later behind the same adapter. Optional 2FA (TOTP app) for staff and admins |
| Hosting                           | Free tiers first (web on Vercel, API/DB/Redis on free hosts) with no custom domain; everything stays cloud-agnostic (Docker, S3-compatible storage, 12-factor config)                                                   |
| Languages                         | English first, i18n-ready from day 1 (next-intl)                                                                                                                                                                        |
| First module after the foundation | Students & Admissions                                                                                                                                                                                                   |

### Research findings

- **PreSkool menu** (crawled): about 300 pages in 12 groups: Main (role dashboards, chat, calendar, email, to-do, notes, file manager), People & Admission, Academic (classes, subjects, curriculum, timetable, lesson planning, homework, exams, report cards, analytics), HRM (payroll, leave, attendance incl. biometric/RFID), Finance (fees, fines, scholarships, invoices, online payments, refunds, accounts, ledger), Campus Ops (library, transport + GPS, sports, hostel, cafeteria, assets, gate/visitor security, medical), Communication (notices, SMS, WhatsApp, email, push, automation rules), Reports + AI insights, Certificates (TC, bonafide, ID cards), Administration (multi-school, tenant settings, subscription plans, branches), Settings (about 50 pages), CMS, and Auth pages.
- **Figma kit** (`DfSa4FTZIeoRuZtclag353`): pages are Design System (logo, colors, typography, buttons, Tabler icons, forms, images), Menu Components, and Screens. Screens include 4 role dashboards, People grids, Management (fees group, library, sports, hostel, routes), HRM, Reports (attendance variants), Academic (class list, room, routine, subject, syllabus, timetable, exam, schedule, grade) and Auth (sign in/up, forgot/reset, email verify, 2-step).
- **Visual language**: light grey canvas, white cards with soft borders, left sidebar with grouped sections and a campus switcher at the top, top bar (search, academic-year switcher, theme, notifications, profile), page header with breadcrumbs and actions on the right, stat cards with coloured icon tiles and status pills, grid/list toggle on entity lists.

---

## 1. Tech stack (pin exact versions at scaffold time; latest stable)

**Monorepo & tooling:** pnpm workspaces · Turborepo · TypeScript (strict) · ESLint (flat config) + Prettier · Husky + lint-staged + commitlint (Conventional Commits) · GitHub Actions CI · Docker Compose for local infrastructure.

**Web (`apps/web`):**

- Next.js (App Router, React 19, Server Components where useful, client components for interactive tables and forms)
- Tailwind CSS v4 + **shadcn/ui** (components vendored into `packages/ui`; Base UI primitives, in line with the installed `migrate-radix-to-base` skill)
- `@tabler/icons-react` (the icon set used in Figma)
- TanStack Query (server state) · TanStack Table (data tables) · `nuqs` (filters/pagination in the URL)
- React Hook Form + Zod (schemas shared with the API)
- `next-intl` (i18n) · `next-themes` (light/dark) · `sonner` (toasts) · `cmdk` (⌘K search) · `vaul` (mobile drawers)
- Recharts via shadcn charts · `react-day-picker` + `date-fns` (+ `date-fns-tz`, IST) · `@dnd-kit` (timetable and drag ordering)
- Serwist (PWA service worker, offline shell, Web Push)
- Storybook (design-system docs and component states)

**API (`apps/api`):**

- NestJS (modular monolith) · Prisma ORM (multi-file schema) · PostgreSQL 17 · Redis
- `nestjs-zod` (shared Zod schemas → validation + OpenAPI) · `@nestjs/swagger` → **Orval** generates a typed client and TanStack Query hooks for web
- Auth: `argon2` (passwords) · JWT access token (15 min) + rotating refresh token in an httpOnly cookie · OTP hashed in Redis with TTL and rate limits · `otplib` (TOTP 2FA)
- Authorization: CASL (role + permission + scope rules)
- BullMQ (jobs: email, web push, PDF generation, imports, reports; SMS/WhatsApp later) · `@nestjs/event-emitter` + transactional outbox for domain events
- `nestjs-pino` (structured logs) · `@nestjs/throttler` · Helmet · `@nestjs/terminus` (health checks)
- Files: S3-compatible storage (MinIO locally) with presigned uploads · `sharp` (image resize)
- PDFs (receipts, report cards, TC, ID cards): HTML templates → **Gotenberg** (Docker) · Excel import/export: `exceljs`
- Provider adapters behind interfaces: email (SMTP; Mailpit locally, a free SMTP relay such as Brevo or Gmail in early deployments), web push and in-app notifications. SMS (MSG91, DLT-compliant), WhatsApp and online payments (Razorpay) are later adapters on the same interfaces, built only when a paying school needs them

**Testing:** Vitest (unit tests in packages, web and API via `unplugin-swc`) · Supertest + **Testcontainers** (API integration tests against real Postgres and Redis) · **Playwright** E2E with device projects (Desktop Chrome/Firefox/WebKit, Pixel 7, iPhone 14, iPad) · `@axe-core/playwright` (accessibility) · Playwright screenshot comparisons for key screens · MSW for web component tests.

**Local infrastructure (`docker/compose.yml`):** postgres, redis, minio, mailpit, gotenberg.

---

## 2. Repository structure

```
classloom/
├─ apps/
│  ├─ web/                         # Next.js app (all role portals)
│  │  ├─ src/app/
│  │  │  ├─ [locale]/(auth)/       # sign-in, otp, forgot/reset, 2fa
│  │  │  ├─ [locale]/(app)/        # authenticated shell (sidebar + topbar)
│  │  │  │  ├─ dashboard/          # role-aware dashboard
│  │  │  │  ├─ students/ admissions/ staff/ attendance/ fees/ ...
│  │  │  │  └─ settings/
│  │  │  ├─ [locale]/(platform)/   # super-admin: tenants, plans
│  │  │  └─ [locale]/onboarding/   # new-school setup wizard
│  │  ├─ src/features/<module>/    # components, hooks, columns, forms per module
│  │  ├─ src/components/shell/     # sidebar, topbar, page-header, switchers
│  │  ├─ src/lib/                  # api client wiring, auth session, i18n, utils
│  │  ├─ messages/en.json          # i18n strings
│  │  └─ e2e/                      # Playwright specs (per module)
│  └─ api/                         # NestJS
│     ├─ src/core/                 # config, prisma, tenancy, auth, iam, audit, files, notifications, jobs, health
│     ├─ src/modules/<module>/     # academic, students, admissions, staff, attendance, fees, ...
│     ├─ prisma/schema/*.prisma    # one schema file per domain
│     ├─ prisma/migrations/  prisma/seed/
│     └─ test/                     # integration tests (Testcontainers)
├─ packages/
│  ├─ ui/                          # shadcn components + Classloom composites (DataTable, StatCard, PageHeader…)
│  ├─ design-tokens/               # tokens.css (Tailwind v4 @theme), light/dark
│  ├─ contracts/                   # shared Zod schemas, enums, permission keys, DTO types
│  ├─ api-client/                  # Orval-generated client + query hooks
│  ├─ utils/                       # INR formatting (lakh/crore), IST dates, Indian validators (phone, PIN, Aadhaar Verhoeff, IFSC)
│  └─ config/                      # shared tsconfig, eslint, vitest, tailwind presets
├─ docker/compose.yml
├─ docs/
│  ├─ superpowers/specs/           # master design + one spec per module
│  ├─ superpowers/plans/           # implementation plan per module/part
│  └─ research/                    # PreSkool/Figma notes per module
├─ .github/workflows/ci.yml
├─ turbo.json  pnpm-workspace.yaml  package.json
```

---

## 3. Backend architecture

**Style:** a modular monolith. Each domain module (`modules/students`, `modules/fees`, …) owns its controller → service → repository (Prisma), its Zod DTOs from `packages/contracts`, permission policies, domain events and jobs. Modules talk through services or events, never through each other's tables. This keeps a later split into services possible without paying for microservices now.

**Multi-tenancy (built in from day 1):**

- Shared database, shared schema; a `tenantId` column on every tenant-owned table.
- Tenant is resolved from the signed-in user's membership (a user picks their school once, by school code, at sign-in) or the `X-Tenant` header (mobile/PWA), then stored in `AsyncLocalStorage`. Subdomains (`dps-dehradun.classloom.in`) are an additional resolver added once a domain is bought; no URL or data change is needed then.
- A Prisma client extension injects `tenantId` into every query. **Postgres Row-Level Security** policies (`SET app.tenant_id` per transaction) provide defence in depth.
- Hierarchy: **Tenant (school org/trust)** → **Campus** (one or more branches; PreSkool's "Global International / Sunrise / Riverside" switcher) → **AcademicYear** → Class → Section.

**Identity & access:**

- `User` is a global identity (phone and/or email). `Membership` links a user to a tenant with roles and campus scope. One parent can hold children in two schools on the platform.
- Default roles: Platform Super Admin, School Owner/Trustee, Principal, School Admin, Accountant, Teacher, Class Teacher (scoped to a section), Librarian, Transport Manager, Receptionist, Parent, Student. Custom roles are composed from permission keys (`students.read`, `fees.collect`, …).
- Login flow: enter email or mobile → email: OTP or password; mobile: password (SMS OTP later) → optional TOTP for staff → access JWT + refresh cookie. Includes device/session list, login activity, lockout and rate limits.

**Cross-cutting conventions:**

- IDs are UUIDv7. Money is stored as integer paise. Dates use the `date` type and IST, displayed DD/MM/YYYY. Rows carry `createdAt/updatedAt/createdBy/updatedBy`; `deletedAt` soft delete applies where records must stay recoverable.
- An audit log for every mutation (who, what, before/after).
- Uniform error shape (RFC 7807 problem+json), cursor/offset pagination, standard list query (search, filters, sort).
- Sensitive PII (Aadhaar) is encrypted at column level and displayed masked (XXXX-XXXX-1234). DPDP: consent records and parental consent for minors, data export and deletion requests.
- Background jobs for anything slow or external (email, PDFs, imports, bulk promotion).

**Core API modules (Phase 1):** `config`, `prisma`, `tenancy`, `auth`, `iam` (users/roles/permissions), `audit`, `files`, `notifications` (channel adapters + templates), `jobs`, `health`, `settings` (school profile, academic years, terms, prefixes, custom fields).

---

## 4. Design tokens (from Figma "Design System" page)

Defined once in `packages/design-tokens/tokens.css` as CSS variables in Tailwind v4 `@theme`, then mapped onto shadcn's semantic variables (`--primary`, `--background`, `--card`, `--muted`, `--border`, `--ring`, `--destructive`…).

| Token                                   | Light                                                                                                  | Notes                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Primary                                 | `#3D5EE1` (ramp 100 `#ECEFFC` → 900 `#506EE4`)                                                         | buttons, active nav, links                                                                 |
| Secondary                               | `#6FCCD8`                                                                                              | accents, charts                                                                            |
| Dark / Ink                              | `#131022` / text `#202C4B` (Grey 900)                                                                  | headings                                                                                   |
| Body text                               | Grey 700 `#515B73`, muted Grey 500 `#838A9B`                                                           |                                                                                            |
| Border                                  | Grey 100 `#E6E8EB`                                                                                     | cards, inputs                                                                              |
| Canvas                                  | Light 500 `#F4F6FA`; card `#FFFFFF`                                                                    |                                                                                            |
| Success / Warning / Danger / Info / Sky | `#1ABE17` / `#EAB300` / `#E82646` / `#0F65CD` / `#05C3FB`                                              | plus "transparent" tints for pills (`#E8F9E8`, `#FEF8EA`, `#FDE9ED`, `#E7F1FC`, `#E6F9FF`) |
| Accent palette                          | Violet `#673AB7`, Pink `#E83E8C`, Orange `#FD7E14`, Green `#2CA87F`, Red `#DC2626` (100–900 ramps)     | stat-card icon tiles, charts, avatars                                                      |
| Dark mode                               | canvas Dark 900 `#0F0C1C`, card Dark 700 `#1B1632`, border Dark 600 `#322D46`, text Dark 100 `#EFEFF2` |                                                                                            |

- **Typography:** Roboto (with Noto Sans Devanagari fallback for future Hindi). Display 40/32/24/20/18/16; H1 28 Bold, H2 24 Bold, H3 20 SemiBold, H4 18 SemiBold, H5 16 Medium, H6 15 Medium; body 14 Regular; nav 14 Medium; XS 12. Fluid scaling on mobile: H1 drops to 22–24.
- **Spacing:** 4px base scale. **Radius:** about 6px base (check against the Figma Buttons/Forms frames in Phase 0), pills full. **Shadows:** a very soft card shadow, plus a stronger elevation for popovers and modals.
- **Breakpoints:** Tailwind defaults (sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536). Touch targets ≥ 44px. WCAG 2.1 AA contrast is checked for every token pair.
- **Icons:** Tabler, 18–20px in nav, 16px inline.
- **Chart palette:** primary, secondary, warning, danger, violet, green, checked for colour-blind safety.

---

## 5. UI structure

**App shell** (`components/shell`):

- **Sidebar:** logo, campus switcher, grouped nav filtered by role permissions, collapsible to icon-only "mini" mode (≥ lg), off-canvas sheet below lg.
- **Top bar:** ⌘K global search (students, staff, pages), academic-year switcher, notifications, theme toggle, language, profile menu.
- **Page header:** title, breadcrumbs, primary/secondary actions (collapsed into a "⋯" menu on mobile).
- **Mobile:** bottom tab bar for Parent/Student/Teacher portals (Home, Attendance, Fees, Messages, More).

**Reusable page patterns (in `packages/ui`):**

1. **List page:** toolbar (search, filter sheet, date range, sort, column visibility, grid/list toggle as in Figma), DataTable with bulk actions, import/export, pagination. Tables turn into card lists below md.
2. **Detail page:** profile header card + tabs (overview, academics, attendance, fees, documents, activity).
3. **Form / wizard:** multi-step stepper with per-step validation, autosaved drafts, sticky footer actions on mobile.
4. **Dashboard:** responsive widget grid; each module contributes widgets (stat cards, charts, lists).
5. **States:** skeletons, empty states with a call to action, error boundaries, permission-denied, offline banner (PWA).

**Role portals (one app, nav and dashboards per role):** Platform admin · School admin/Principal · Accountant · Teacher · Parent · Student.

---

## 6. Module roadmap (each module → parts → steps)

Phases run in order. Each part is a shippable slice with its own spec, plan, tests and cross-device check.

**Phase 0 — Foundation (no business features)**

1. Monorepo scaffold (pnpm, Turborepo, TS configs, lint, commit hooks, CI).
2. Docker infrastructure (Postgres, Redis, MinIO, Mailpit, Gotenberg) + `.env` handling.
3. Design tokens + shadcn setup in `packages/ui` + Storybook with the token pages.
4. App shell (sidebar, top bar, page header, mobile nav, theme, i18n) using mock nav data.
5. API skeleton (NestJS, Prisma, health check, error format, logging, OpenAPI → Orval pipeline).
6. Test harness: Vitest, Testcontainers, Playwright device projects, axe checks, all running in CI.

**Phase 1 — Platform core**

1. Tenancy: tenant + campus model, school code, tenant resolution from session/header (subdomain resolver later), RLS, platform super-admin tenant CRUD.
2. Auth: email OTP or password, mobile + password, refresh rotation, forgot/reset, TOTP 2FA, sessions, login activity, rate limits (all PreSkool auth screens re-designed).
3. IAM: users, roles, permission matrix UI, role-filtered navigation.
4. School onboarding wizard: profile (name, board, UDISE+ code, affiliation no., logo, address), academic year (April–March) and terms, campuses.
5. Academic structure: classes (Nursery–XII), sections, streams (Sci/Com/Arts for XI–XII), subjects (scholastic/co-scholastic, board codes), class-subject mapping, houses, rooms.
6. Settings framework: ID/receipt prefixes, custom fields, notification templates, audit log viewer.

**Phase 2 — Students & Admissions** (first business module)

1. Admission enquiry (CRM): lead capture form (public + desk), follow-ups, status pipeline, source tracking.
2. Admission application: multi-step form (student, parents/guardians, previous school, documents, category GEN/OBC/SC/ST/EWS, RTE 25% quota flag), application fee hook, review/approve, entrance test/interview slot.
3. Student records: admission number generation, profile (APAAR ID, PEN, Aadhaar masked, blood group, religion, mother tongue, address with PIN/state), siblings, list/grid with filters, bulk Excel import with validation report.
4. Parents & guardians: linked accounts, invite by email (or a printed invite code for parents without email), multiple children per parent.
5. Documents: upload/verify (birth certificate, TC from previous school, Aadhaar, photos, caste certificate).
6. Lifecycle: section allocation, roll numbers, promotion/detention at year end (bulk), transfer certificate issue, alumni.
7. Student 360 detail page (tabs fill in as later modules land).

**Phase 3 — Staff & HR basics:** staff onboarding, departments, designations, documents, teacher–subject–section assignments, class teacher allocation.

**Phase 4 — Attendance & Leave:** daily/period-wise student attendance (fast mobile marking), staff attendance, holidays calendar, leave requests/approvals, absence alerts to parents (email, in-app and web push), biometric/RFID import hook, reports.

**Phase 5 — Fees & Payments:** fee heads/groups, structures per class/category, instalments (monthly/quarterly/term), concessions (sibling, staff ward, RTE, scholarship), late fines, counter collection (cash/cheque/DD/UPI with the transaction reference recorded by staff), receipts (PDF, 80C tuition component), dues and defaulter reports, refunds, reminders. **Online payment (Razorpay) is out of scope** until a school needs it.

**Phase 6 — Communication:** notice board and circulars, targeted announcements (class/section/role), email, web push and in-app notifications, scheduled broadcasts, delivery logs, parent–teacher messaging. SMS and WhatsApp channels are deferred (paid services).

**Phase 7 — Timetable & Learning:** period structure, class/teacher timetables with clash detection, substitutions, syllabus tracking, lesson plans, homework/assignments with submissions, study materials.

**Phase 8 — Examinations & Report cards:** exam types (PT/half-yearly/annual), schedules, admit cards, marks entry (fast grid, mobile-friendly), grading rules (CBSE A1–E2, state boards, custom), co-scholastic grades, report cards (CBSE format + NEP holistic progress card), results analytics and ranking.

**Phase 9 — Dashboards & Reports:** finished role dashboards (as in the Figma admin/teacher/student/parent screens), report builder, scheduled report emails, UDISE+ export.

**Phase 10+ — Extended operations (order to be confirmed later):** certificates and ID cards (bonafide, character, TC templates, ID card designer) · payroll (PF/ESI/TDS/PT, payslips) · accounts (income/expense, ledger) · library · transport (routes, stops, vehicles, GPS, transport fees) · hostel · inventory/assets · gate/visitor management · medical room · events/sports/achievements · calendar/to-do/file manager · platform subscription billing and usage limits · AI insights (attendance risk, fee forecast) · native Expo app.

---

## 7. Per-module workflow (repeated for every module and part)

1. **Research:** crawl the matching PreSkool pages (and Figma frames where present) and note fields, layouts and flows. Add Indian-context requirements. Save to `docs/research/<module>.md`.
2. **Spec:** `docs/superpowers/specs/YYYY-MM-DD-<module>-design.md` covering user stories per role, data model, API endpoints, permissions, screens (desktop + mobile), edge cases. **You approve it.**
3. **Implementation plan:** `docs/superpowers/plans/…` with bite-sized TDD tasks. **You approve it** and pick the execution mode.
4. **Build, in this order:** Prisma schema + migration + seed → contracts (Zod) → API with unit + integration tests (tenant isolation and permission tests are mandatory) → regenerate the client → UI (Storybook states first, then pages) → Playwright E2E.
5. **Cross-device check:** Playwright on all device projects + axe accessibility + screenshots at 375 / 768 / 1280 / 1536, plus a manual pass in the browser pane (light and dark).
6. **Review & ship:** code review, then commit on a feature branch and open a PR per part.

**Definition of done for a part:** migrations apply cleanly; unit, integration and E2E tests pass on all device projects; no axe violations; works in both themes; every string in i18n; permissions enforced on both API and UI; audit log entries written; seed data demonstrates the feature.

---

## 8. Immediate next steps after you approve this plan

1. `git init` in `E:\Classloom`. Save this master design to `docs/superpowers/specs/2026-10-25-classloom-master-design.md` and commit it.
2. Write the **Phase 0 implementation plan** (writing-plans skill) covering parts 0.1–0.6, task by task, for your approval.
3. Execute Phase 0, then start Phase 1 research/spec.

### Free-tier scope (decided 2026-10-26)

Until there is a paying school, Classloom uses no paid services:

| Need                  | Now (free)                                                                          | Later (when a school pays)                       |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| OTP and notifications | Email OTP; email, in-app and web push notifications                                 | SMS OTP (sender ID + DLT registration), WhatsApp |
| Fee collection        | Recorded at the counter (cash/cheque/DD/UPI reference) with receipts                | Online payment (Razorpay)                        |
| URL and tenants       | Platform URL (e.g. `classloom.vercel.app`), school chosen by school code at sign-in | Own domain with a subdomain per school           |
| Hosting               | Web on Vercel; API, Postgres and Redis on free tiers                                | Paid hosting in India (DPDP)                     |

Each "later" item plugs into an interface that already exists (notification channels, payment provider, tenant resolver), so adding it does not change the data model. Vercel's free Hobby plan is for non-commercial use: move to Pro (or another host) before charging a school.

---

## 9. Verification (end of Phase 0)

- `docker compose -f docker/compose.yml up -d` → all services healthy.
- `pnpm install && pnpm dev` → web on :3000 shows the app shell; API on :4000 `/health` is OK and `/docs` shows OpenAPI.
- `pnpm lint && pnpm typecheck && pnpm test` pass (unit + Testcontainers integration).
- `pnpm e2e` passes on Desktop Chrome/Firefox/WebKit, Pixel 7, iPhone 14 and iPad, with zero axe violations on the shell.
- `pnpm storybook` shows token pages (colours, type scale, spacing) matching the Figma Design System frames.
- CI workflow is green on the first PR.
