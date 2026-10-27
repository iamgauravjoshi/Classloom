# Auth: sign-in and sessions (Phase 1, Part 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People with a membership sign in to their school by email code or password, stay signed in through a database session behind a first-party cookie, recover a lost password by email, and the web app uses the real session instead of the mock.

**Architecture:**

- A new `auth` module in the NestJS API owns sessions, sign-in (password and email code), passwords and the `/me` account endpoints. A `SessionMiddleware` resolves the cookie into `request.auth` and enters the tenant context; a global `AuthGuard` refuses everything not marked `@Public()`.
- Short-lived state (codes, pauses, reset tokens) lives in Redis; sessions and the sign-in event log live in Postgres as platform-level tables.
- The web app proxies `/api/*` to the API with a Next.js rewrite, so the cookie is first-party. New `(auth)` pages (sign-in, forgot, reset) and an `(app)/account` page; the `(app)` layout reads the session on the server.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL 17, Redis + BullMQ, `argon2`, `@nestjs/throttler`, Next.js 16 rewrites + next-intl, react-hook-form + Zod, shadcn/ui (`input-otp`), Vitest, Testcontainers (Postgres, Redis, Mailpit), Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-27-auth-sign-in-design.md` (read it with this plan; section numbers below refer to it).

## Global Constraints

- Branch `feat/p1-auth-sign-in` from `main` after the spec PR (#5) merges; Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; one PR against `main`.
- New dependencies pinned exactly; `argon2` gets `allowBuilds: argon2: true` in `pnpm-workspace.yaml`.
- Primary keys `@default(uuid(7)) @db.Uuid`; timestamps `@db.Timestamptz(6)`.
- `sessions` and `auth_events` are platform-level (no RLS) and go into `PLATFORM_MODELS_WITH_TENANT_FK`.
- Fixed values (spec sections 4, 6, 7, 11):
  - Session: remembered sliding 30 days, capped at sign-in + 90 days; not remembered idle 2 hours, absolute 12 hours; `last_seen_at` touched at most every 5 minutes; cookie `Max-Age` re-sent at most once a day.
  - Code: 6 digits, 10-minute TTL, 5 attempts; sends: 1 per 60 s, 5 per hour per user and school.
  - Pause: 5 failed passwords per identifier and school in 15 minutes → 15-minute pause.
  - Reset link: 30-minute TTL, 3 per hour per user, newest only.
  - Recent sign-in: 10 minutes. `PATCH /me`: 20 per hour per user.
  - Password: 10–128 characters; not in the bundled 10,000 common list (case-insensitive); not containing the email local part (≥ 4 characters) or a school code.
  - argon2id: `memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`.
  - Clean-up: sessions expired or revoked more than 7 days ago; `auth_events` older than 1 year; daily.
- Env defaults: `SIGN_IN_RATE_LIMIT_PER_15_MIN=30`, `CODE_REQUEST_RATE_LIMIT_PER_HOUR=10`, `PASSWORD_RESET_RATE_LIMIT_PER_HOUR=10`, `TRUST_PROXY=loopback`, `COOKIE_SECURE` = `NODE_ENV === 'production'`.
- Cookie: `__Host-cl_session` when `COOKIE_SECURE`, else `cl_session`; `HttpOnly; SameSite=Lax; Path=/`; `Secure` only when `COOKIE_SECURE`; never a `Domain`.
- Every "account may not exist" path answers identically in body and status; the typed identifier is never stored in Postgres or logged.
- All API errors are RFC 7807 via `ProblemFilter`; validation errors carry `errors[]` with `path`. Problem `type` values introduced here: `sign-in-paused`, `recent-sign-in-required`.
- All web copy in `apps/web/messages/en.json`, all email copy in `apps/api/messages/en.json`. Exact user-facing strings are those in spec sections 6–8.
- Every new page passes the 6 Playwright device projects with zero axe WCAG 2.1 AA violations in light and dark, and has no horizontal overflow at 375 px. Touch targets 44 px under `pointer-coarse:`.

## Review Focus

1. **Identifier variants.** `" Anita@School.IN "`, `9876543210`, `+91 98765 43210` and `098765 43210` must reach the same account and the same pause counter (Task 3 test on `identifierKey`, Task 6 test pausing across variants).
2. **Two tabs, one sign-out.** After tab A signs out, tab B's next client-side query must land on the sign-in page with `next` set, not show a broken dashboard (Task 10 unit test on the 401 handler, Task 14 E2E).
3. **Sign-in while already signed in at another school.** The old session is revoked (`REPLACED`), the cookie points at the new one, and the old token no longer works (Task 6 test).
4. **Code typed with spaces or pasted as `482 913`.** The verify endpoint accepts digits with spaces stripped; letters are a `400` (Task 2 schema test, Task 7 test).
5. **Open redirect through `next`.** `//evil.example`, `/\evil.example`, `https://evil.example`, `/fr/dashboard` (unsupported locale) and `/en/sign-in` (loop) all fall back to the dashboard (Task 1 test).

---

## File structure

```
packages/utils/src/safe-next-path.ts (+ test)          safeNextPath
packages/contracts/src/auth.ts (+ test)                password, sign-in, code, session, me, forgot/reset schemas
apps/api/prisma/schema/auth.prisma                     Session, AuthEvent, enums
apps/api/prisma/schema/tenancy.prisma                  User: passwordHash, passwordChangedAt, sessions relation
apps/api/prisma/migrations/<ts>_auth/migration.sql     tables, mobile de-duplication + partial unique index
apps/api/src/core/config/env.schema.ts (+ test)        new env vars
apps/api/src/modules/auth/
  auth.module.ts
  crypto.ts (+ test)                                   randomToken, sha256, hmac, identifierKey
  password-policy.ts (+ test), common-passwords.txt    checkPasswordPolicy
  password.service.ts (+ test)                         hash, verify, verifyDummy, needsRehash
  session-expiry.ts (+ test)                           pure expiry maths
  session.service.ts                                   create, resolve, touch, revoke, revokeAllForUser
  session-cookie.ts (+ test)                           cookie name and options
  auth-events.service.ts                               record
  auth-cleanup.processor.ts                            daily clean-up job
  session.middleware.ts, origin-check.middleware.ts
  auth.guard.ts, public.decorator.ts, current-auth.decorator.ts
  session.controller.ts                                GET /auth/session, POST /auth/sign-out
  password-sign-in.service.ts, sign-in.controller.ts   POST /auth/sign-in/password
  sign-in-pause.service.ts                             Redis failure counter and pause
  email-code.service.ts, email-code.processor.ts       POST /auth/otp/request, /auth/otp/verify
  password-reset.service.ts, password-reset.processor.ts, password.controller.ts
  account.service.ts, account.controller.ts            GET/PATCH /me, PUT /me/password
  dto.ts
apps/api/src/core/email/templates/sign-in-code.ts, password-reset.ts (+ tests)
apps/api/test/auth/*.int.test.ts, apps/api/test/auth/helpers.ts
packages/ui/src/components/ui/input-otp.tsx; components/password-input.tsx, password-rules.tsx, auth-card.tsx (+ stories, tests)
packages/api-client/src/fetcher.ts                     same-origin base
apps/web/next.config.ts                                /api rewrite
apps/web/src/proxy.ts, src/lib/auth-redirect.ts (+ test)
apps/web/src/lib/session.ts (+ test), src/lib/server-session.ts
apps/web/src/app/[locale]/(auth)/layout.tsx, sign-in/page.tsx, forgot-password/page.tsx, reset-password/page.tsx
apps/web/src/app/[locale]/(app)/account/page.tsx
apps/web/src/features/auth/*, apps/web/src/features/account/*
apps/web/e2e/auth.setup.ts, e2e/auth.spec.ts, e2e/support/school.ts
```

---

### Task 1: Configuration, contracts and the safe `next` path

**Files:**

- Modify: `apps/api/src/core/config/env.schema.ts` (+ test), `apps/api/test/setup-containers.ts`, `.env.example`
- Create: `packages/contracts/src/auth.ts` (+ `auth.test.ts`), export from `index.ts`; `packages/utils/src/safe-next-path.ts` (+ test), export from `index.ts`

**Interfaces:**

- Produces:
  - `Env` gains `AUTH_SECRET: string` (min 32), `COOKIE_SECURE: boolean`, `TRUST_PROXY: string`, `SIGN_IN_RATE_LIMIT_PER_15_MIN`, `CODE_REQUEST_RATE_LIMIT_PER_HOUR`, `PASSWORD_RESET_RATE_LIMIT_PER_HOUR` (numbers).
  - Contracts: `passwordSchema`, `passwordSignInRequestSchema` (`schoolCode, identifier, password, remember`), `codeRequestSchema` (`schoolCode, email`), `codeRequestAcceptedSchema` (`maskedEmail`), `codeVerifyRequestSchema` (`schoolCode, email, code, remember`), `authSessionSchema` (spec section 6 JSON), `forgotPasswordRequestSchema` (`identifier`), `resetPasswordRequestSchema` (`token, newPassword`), `meSchema`, `updateMeRequestSchema` (`name?, mobile?: string | null`), `setPasswordRequestSchema` (`currentPassword?, newPassword`); types `AuthSession`, `Me`, `MembershipRoleName = 'OWNER'`.
  - `safeNextPath(next: string | null | undefined, locales: readonly string[], fallback: string): string`.

- [ ] **Step 1: Write failing tests**
  - `env.schema.test.ts`: missing `AUTH_SECRET` and a 31-character one are reported; `COOKIE_SECURE` defaults to `true` with `NODE_ENV=production` and `false` with `development`; `COOKIE_SECURE=false` overrides production; limits default to 30/10/10; `TRUST_PROXY` defaults to `loopback`.
  - `auth.test.ts`: `passwordSchema` rejects 9 and 129 characters and accepts `'correct horse 10'`; `codeVerifyRequestSchema` turns `'482 913'` into `'482913'` and rejects `'48291a'` and `'48291'`; `codeRequestSchema` rejects a mobile number in `email`; schemas trim and uppercase `schoolCode` (via `normaliseSchoolCode`); `updateMeRequestSchema` maps `'98765 43210'` to `'+919876543210'` and keeps `null`.
  - `safe-next-path.test.ts`: `/en/students?x=1` kept; `//evil.example`, `/\\evil.example`, `https://evil.example`, `/fr/dashboard`, `en/dashboard`, `''`, `null` → fallback; `/en/sign-in` and `/en/sign-in?next=x` → fallback (no loop).

- [ ] **Step 2: Run them and see them fail**
      Run: `pnpm --filter @classloom/api test env.schema && pnpm --filter @classloom/contracts test auth && pnpm --filter @classloom/utils test safe-next-path`
      Expected: FAIL (missing keys/modules).

- [ ] **Step 3: Implement**
  - `COOKIE_SECURE`: preprocess `'true'/'false'` strings; when absent, derive from `NODE_ENV` in a `.transform` on the whole object.
  - Contracts reuse `parseIdentifier`, `normalizeIndianMobile`, `normaliseSchoolCode` from `@classloom/utils`; `identifier` accepts what `parseIdentifier` accepts.
  - `.env.example`: add `AUTH_SECRET=dev-only-auth-secret-change-me-0123456789` with a comment, the three limits, `API_INTERNAL_URL=http://localhost:4000` (web), and remove `NEXT_PUBLIC_API_URL`. `setup-containers.ts`: add the new keys to the test `env` (`AUTH_SECRET` 32+ characters, `COOKIE_SECURE: false`, `TRUST_PROXY: 'loopback'`).

- [ ] **Step 4: Run the tests and see them pass**, plus `pnpm typecheck`.

- [ ] **Step 5: Commit** `feat(contracts): add auth schemas, env and safe next path`

---

### Task 2: Auth schema, migration and registration mobile rule

**Files:**

- Create: `apps/api/prisma/schema/auth.prisma`, `apps/api/prisma/migrations/<ts>_auth/migration.sql`
- Modify: `apps/api/prisma/schema/tenancy.prisma` (User), `apps/api/src/core/tenancy/tenant-scoped-models.ts`, `apps/api/src/modules/tenancy/school-registration.service.ts`
- Test: `apps/api/test/auth/schema.int.test.ts`, `apps/api/test/tenancy/registration.int.test.ts` (add a case)

**Interfaces:**

- Produces: Prisma models `Session` (fields per spec section 4; `revokedReason SessionRevokedReason?`), `AuthEvent` (`type AuthEventType`, `method AuthMethod?`), enums `SessionRevokedReason { SIGNED_OUT PASSWORD_CHANGED PASSWORD_RESET REPLACED }`, `AuthEventType` (spec section 4 list), `AuthMethod { PASSWORD EMAIL_CODE RESET_LINK }`. `User.passwordHash String?`, `User.passwordChangedAt DateTime?`, `User.mobile` unique where not null. `PLATFORM_MODELS_WITH_TENANT_FK` = `RegistrationToken`, `Session`, `AuthEvent`.

- [ ] **Step 1: Write failing tests**
  - `schema.int.test.ts`: two users with the same non-null mobile → unique violation (`users_mobile_key` partial index); two users with null mobiles succeed; deleting a user cascades its sessions and nulls `auth_events.user_id`; deleting a tenant cascades sessions.
  - Migration de-duplication (owner-role client, throwaway container): drop `users_mobile_key`, seed three users sharing one mobile, run the statement read from `migration.sql` between the markers `-- dedupe:start` and `-- dedupe:end`, assert only the oldest keeps the number, then recreate the index.
  - `registration.int.test.ts`: registering with a mobile already held by another user returns `202`, creates the school, and the new owner's `mobile` is `null`.
  - The existing `tenant-scoped-models.test.ts` passes once the registry is updated.

- [ ] **Step 2: Run and see them fail**
      Run: `pnpm --filter @classloom/api test:int -- schema registration`
      Expected: FAIL (no tables / 500 on the duplicate mobile).

- [ ] **Step 3: Implement**
  - Write the Prisma models, then `pnpm --filter @classloom/api exec prisma migrate dev --create-only --name auth` and edit the SQL: the de-duplication `UPDATE users SET mobile = NULL WHERE id IN (… row_number() over (partition by mobile order by created_at, id) > 1)` between the markers, before `CREATE UNIQUE INDEX users_mobile_key ON users (mobile) WHERE mobile IS NOT NULL`. Grant `SELECT, INSERT, UPDATE, DELETE` on the two new tables to `classloom_app` only if the default privileges from `01-roles.sql` do not already cover them (check with the roles test).
  - Registration: before the transaction, if `input.mobile` belongs to a different user (lookup by mobile, not the same email), drop it from the create. A unique-index race on `users_mobile_key` is accepted (rare 500); note it in a code comment.

- [ ] **Step 4: Run** `pnpm --filter @classloom/api test && pnpm --filter @classloom/api test:int` → all pass.

- [ ] **Step 5: Commit** `feat(api): add sessions, auth events and unique mobiles`

---

### Task 3: Crypto, password policy and password hashing

**Files:**

- Create: `apps/api/src/modules/auth/crypto.ts`, `password-policy.ts`, `common-passwords.txt`, `password.service.ts` (+ unit tests each)
- Modify: `apps/api/package.json` (`argon2`), `pnpm-workspace.yaml` (`argon2: true`), `apps/api/nest-cli.json` or build config so `common-passwords.txt` is copied to `dist` (assets)

**Interfaces:**

- Produces:
  - `randomToken(): string` (32 bytes, base64url); `sha256(value: string): Buffer`; `hmac(secret: string, value: string): string` (hex); `identifierKey(secret: string, tenantId: string, identifier: string): string` (HMAC of `tenantId + ':' + normalised identifier`, normalised with `parseIdentifier`; unparseable input is lowercased and trimmed).
  - `checkPasswordPolicy(password: string, ctx: { email: string; schoolCodes: string[] }): PasswordIssue[]` where `PasswordIssue = 'too_short' | 'too_long' | 'common' | 'contains_email' | 'contains_school_code'`.
  - `PasswordService`: `hash(password): Promise<string>`, `verify(hash: string, password: string): Promise<boolean>`, `verifyDummy(password: string): Promise<false>` (verifies against a hash computed once at startup), `needsRehash(hash: string): boolean`.

- [ ] **Step 1: Write failing tests**
  - `crypto.test.ts`: `identifierKey` is equal for `' Anita@School.IN '` and `'anita@school.in'`, and for `9876543210`, `+91 98765 43210`, `098765 43210`; differs across tenants; `randomToken()` is 43 characters and unique across 1,000 calls.
  - `password-policy.test.ts`: `'password1234'` → `['common']`; `'Password1234'` → `['common']`; `'anita-secret-99'` for `anita@x.in` → `['contains_email']`; `'abc'` local part (`abc@x.in`) does not trigger `contains_email`; `'my gisd password'` with `['GISD']` → `['contains_school_code']`; a 129-character string → `['too_long']`; a strong passphrase → `[]`.
  - `password.service.test.ts`: a hash starts with `$argon2id$v=19$m=19456,t=2,p=1$`; `verify` true/false; `verifyDummy` resolves `false`; `needsRehash` is true for a hash made with `timeCost: 1`.

- [ ] **Step 2: Run** `pnpm --filter @classloom/api test crypto password` → FAIL.

- [ ] **Step 3: Implement.** `common-passwords.txt`: the first 10,000 lines of SecLists `Passwords/Common-Credentials/10k-most-common.txt` (MIT; add its licence line as the file's first comment line, skipped by the loader), loaded once into a lowercase `Set`. HMAC comparisons elsewhere use `timingSafeEqual`.

- [ ] **Step 4: Run** → PASS; `pnpm --filter @classloom/api build` and confirm `dist/modules/auth/common-passwords.txt` exists.

- [ ] **Step 5: Commit** `feat(api): add password policy, hashing and auth crypto helpers`

---

### Task 4: Sessions, sign-in events and clean-up

**Files:**

- Create: `apps/api/src/modules/auth/session-expiry.ts` (+ test), `session.service.ts`, `auth-events.service.ts`, `auth-cleanup.processor.ts`, `auth.module.ts`; register `AuthModule` in `app.module.ts`
- Test: `apps/api/test/auth/sessions.int.test.ts`, `apps/api/test/auth/helpers.ts`

**Interfaces:**

- Consumes: `randomToken`, `sha256` (Task 3).
- Produces:
  - `initialExpiry(now: Date, remember: boolean): { expiresAt: Date; idleExpiresAt: Date | null }`; `slidExpiry(session: { remember; authenticatedAt; expiresAt; idleExpiresAt }, now: Date): { expiresAt; idleExpiresAt } | null` (null when the 5-minute touch interval has not passed); `isExpired(session, now): boolean`.
  - `SessionService`:
    - `create(input: { userId; tenantId; membershipId; remember: boolean; ip?: string; userAgent?: string; replacesToken?: string }): Promise<{ token: string; session: Session }>` (revokes the replaced session with `REPLACED`).
    - `resolve(token: string, now?: Date): Promise<ResolvedSession | null>` where `ResolvedSession = { session: Session; tenant: { id; code; name; status } }`; null when unknown, revoked, expired or the tenant is not `ACTIVE`.
    - `touch(session: Session, now?: Date): Promise<{ cookieRefresh: boolean }>`.
    - `revoke(sessionId, reason)`, `revokeAllForUser(userId, reason, exceptSessionId?)`.
    - `toAuthSession(resolved, membership, user): Promise<AuthSession>` (loads the primary campus inside `withTenant`).
  - `AuthEventsService.record(event: { type; method?; userId?; tenantId?; sessionId?; ip?; userAgent? }): Promise<void>` (truncates `userAgent` to 512, never throws: logs and swallows).
  - `test/auth/helpers.ts`: `seedSchool(prisma, { code, email, mobile?, password? }): Promise<{ tenantId; userId; membershipId }>` (owner-role client; hashes `password` with `PasswordService`).

- [ ] **Step 1: Write failing tests**
  - `session-expiry.test.ts` (fake clock): remembered → `expiresAt` = now + 30 d, `idleExpiresAt` null; not remembered → now + 12 h and now + 2 h; slide after 4 min → null; after 6 min remembered → `last_seen + 30 d`, but never past `authenticatedAt + 90 d`; not remembered slides only the idle expiry; `isExpired` true at either boundary.
  - `sessions.int.test.ts`: `create` stores only the hash (raw token not in the row); `resolve` returns the session; returns null after `revoke`, after `expiresAt`, after `idleExpiresAt`, and while the tenant is `SUSPENDED`, and works again after it is `ACTIVE`; `create` with `replacesToken` revokes the old one with `REPLACED`; `revokeAllForUser` with `exceptSessionId` keeps one; clean-up deletes a session revoked 8 days ago and an event 366 days old but keeps a session revoked 6 days ago and an event 364 days old.

- [ ] **Step 2: Run** `pnpm --filter @classloom/api test session-expiry && pnpm --filter @classloom/api test:int -- sessions` → FAIL.

- [ ] **Step 3: Implement.** Clean-up follows `PendingCleanupService`/`PendingCleanupProcessor`: queue `MAINTENANCE_QUEUE`, scheduler id `auth-cleanup`, `upsertJobScheduler` with a daily `every` (`86_400_000`), registered on module init without blocking boot. `resolve` is one query on `sessions` with the tenant included (both platform-level).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `feat(api): add database sessions, auth events and their clean-up`

---

### Task 5: Request pipeline: middleware, guard, origin check, session endpoints

**Files:**

- Create: `apps/api/src/modules/auth/session-cookie.ts` (+ test), `session.middleware.ts`, `origin-check.middleware.ts`, `auth.guard.ts`, `public.decorator.ts`, `current-auth.decorator.ts`, `session.controller.ts`, `dto.ts`
- Modify: `apps/api/src/main.ts` (`app.set('trust proxy', env.TRUST_PROXY)`; no `cookie-parser`: `session-cookie.ts` reads the one cookie from `req.headers.cookie`), `auth.module.ts` (`configure(consumer)` applies both middlewares to all routes; `APP_GUARD` → `AuthGuard`), every existing controller (`@Public()` on `HealthController`, `SchoolsController`, `SchoolRegistrationsController`), Swagger setup (exclude `/docs` from the guard by being outside Nest routing; add `addCookieAuth(cookieName)`)
- Test: `session-cookie.test.ts`; `apps/api/test/auth/pipeline.int.test.ts`; existing integration suites must still pass

**Interfaces:**

- Consumes: `SessionService`, `AuthEventsService` (Task 4).
- Produces:
  - `sessionCookieName(env): string`; `sessionCookieOptions(env, remember: boolean): CookieOptions`; `readSessionToken(req, env): string | undefined`; `setSessionCookie(res, env, token, remember)`; `clearSessionCookie(res, env)`.
  - `RequestAuth = { sessionId; userId; tenantId; membershipId; role: 'OWNER'; remember: boolean; authenticatedAt: Date }` on `request.auth`; `@CurrentAuth()` param decorator; `@Public()`.
  - `GET /auth/session` → `AuthSession`; `POST /auth/sign-out` → 204 (`@Public()`: also works signed out), writes `SIGNED_OUT`.

- [ ] **Step 1: Write failing tests**
  - `session-cookie.test.ts`: secure env → name `__Host-cl_session`, `secure: true`; insecure → `cl_session`, no `secure`; remembered → `maxAge` 30 days; not remembered → no `maxAge`; never a `domain`; `readSessionToken` finds the cookie among others.
  - `pipeline.int.test.ts` (sessions created through `SessionService` + `seedSchool`):
    - `GET /auth/session` without a cookie → 401 problem+json; with a valid cookie → 200 matching `authSessionSchema`, `school.code` uppercase, `campus` is the primary campus.
    - Invalid cookie (unknown, revoked, expired) → 401 and a `Set-Cookie` clearing it.
    - Tenant suspended (owner-role update) → 401; reactivated → 200 again. Membership `REVOKED` → 401.
    - Tenant context: a probe route registered only in this test module (`@Get('__probe')` returning `prisma.scoped.campus.findMany()`) returns only the session school's campuses with two schools seeded.
    - `POST /auth/sign-out` with `Origin: http://evil.example` and the cookie → 403; with `Origin` = `WEB_ORIGIN` → 204, cookie cleared, session revoked, `SIGNED_OUT` recorded; repeated without a cookie → 204.
    - `GET /health` and `GET /schools/code-availability` still work without a cookie.
    - `X-Forwarded-For: 203.0.113.9` from loopback with `TRUST_PROXY=loopback` → the `SIGNED_OUT` event's `ip` is `203.0.113.9`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**
  - `SessionMiddleware`: resolve → `tenantContext.run(tenantId, () => …)` wrapping the membership check (`prisma.scoped.membership.findFirst({ where: { id, status: 'ACTIVE' } })`) and then `next()`, so the handler runs inside the context; touch and, when `cookieRefresh`, re-set the cookie.
  - `OriginCheckMiddleware`: only for `POST|PUT|PATCH|DELETE` that carry the session cookie; compares `Origin` to `new URL(env.WEB_ORIGIN).origin`; missing `Origin` with the cookie → 403.
  - `AuthGuard` uses `Reflector.getAllAndOverride(IS_PUBLIC, [handler, class])`.

- [ ] **Step 4: Run** `pnpm --filter @classloom/api test && pnpm --filter @classloom/api test:int` → all pass (including Part 1 suites).

- [ ] **Step 5: Commit** `feat(api): resolve sessions on every request and guard non-public routes`

---

### Task 6: Password sign-in and pauses

**Files:**

- Create: `apps/api/src/modules/auth/sign-in-pause.service.ts`, `password-sign-in.service.ts`, `sign-in.controller.ts`
- Modify: `apps/api/src/core/http/throttler-names.ts` (`SIGN_IN_THROTTLER`, `CODE_REQUEST_THROTTLER`, `PASSWORD_RESET_THROTTLER`, all in `skipAllBut`), `app.module.ts` (three throttlers from env: 15-minute, hour, hour TTLs)
- Test: `apps/api/test/auth/password-sign-in.int.test.ts`

**Interfaces:**

- Consumes: `identifierKey`, `PasswordService`, `SessionService`, `AuthEventsService`, `setSessionCookie`.
- Produces:
  - `SignInPauseService`: `isPaused(tenantId, identifier): Promise<number | null>` (seconds left), `recordFailure(tenantId, identifier): Promise<{ paused: boolean }>`, `clear(tenantId, identifier)`. Redis errors → logged, treated as not paused (fail open).
  - `PasswordSignInService.signIn(input, meta: { ip?; userAgent?; currentToken?: string }): Promise<{ token: string; session: AuthSession; remember: boolean }>`; throws `InvalidCredentialsException` (401, title "Email/mobile or password is incorrect.") or `SignInPausedException` (429, `type: 'sign-in-paused'`, `retryAfter` seconds, `Retry-After` header).
  - `POST /auth/sign-in/password` (`@Public()`, `SIGN_IN_THROTTLER`).

- [ ] **Step 1: Write failing tests** (`password-sign-in.int.test.ts`):
  - Success by email and by mobile (`98765 43210`): 200 body matches `authSessionSchema`, cookie set, `SIGN_IN_SUCCEEDED` with `method: PASSWORD`.
  - Identical 401 body (deep-equal after removing `instance`) for: wrong password, unknown email, user without a password, revoked membership, a user from another school, unknown school code.
  - Timing: median of 5 attempts for an unknown email is within 40% of the median for a known email with a wrong password (both run argon2).
  - Pause: 5 wrong passwords → the 5th returns 429 `sign-in-paused`; the 6th with the **right** password is 429; a different spelling of the same identifier (`' ANITA@school.in'`) is also paused; an unknown identifier pauses the same way; `SIGN_IN_PAUSED` recorded once.
  - Signing in while holding a valid cookie from school A, at school B: A's session is revoked with `REPLACED`.
  - A password hashed with old parameters is re-hashed on success.
  - IP limit: with `SIGN_IN_RATE_LIMIT_PER_15_MIN=3` in this suite's env, the 4th attempt is 429 without `sign-in-paused`.
  - Redis outage (last test, Redis container stopped): the right password still signs in (pause and IP limits fail open), and a warning is logged.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** per spec section 6, "Password sign-in rules", in that order; the dummy verify runs whenever the school, user, membership or hash is missing. Membership lookup uses `withTenant(prisma, tenant.id, …)`.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `feat(api): sign in with a password, with pauses after failures`

---

### Task 7: Email-code sign-in

**Files:**

- Create: `apps/api/src/modules/auth/email-code.service.ts`, `email-code.processor.ts`, `apps/api/src/core/email/templates/sign-in-code.ts` (+ test); add routes to `sign-in.controller.ts`; copy in `apps/api/messages/en.json`
- Test: `apps/api/test/auth/email-code.int.test.ts`

**Interfaces:**

- Consumes: `hmac`, `SessionService`, `AuthEventsService`, `EmailService.enqueue`, `QueueProducer`, `maskEmail` (tenancy).
- Produces:
  - `AUTH_QUEUE = 'auth'`; job names `SEND_CODE_JOB = 'send-code'` (data `{ schoolCode, email }`), later `SEND_RESET_JOB = 'send-reset'` (Task 8).
  - `EmailCodeService`: `request(input): Promise<{ maskedEmail }>` (enqueue only), `processSend(data)`, `verify(input, meta): Promise<{ token; session: AuthSession; remember }>` throwing `InvalidCodeException` (401, "That code is incorrect or has expired.").
  - `signInCodeEmail({ schoolName, code, minutes: 10 }): { subject; html; text }` with subject `` `${code} is your Classloom sign-in code` ``.
  - `POST /auth/otp/request` (202, `CODE_REQUEST_THROTTLER`), `POST /auth/otp/verify` (200, `SIGN_IN_THROTTLER`).

- [ ] **Step 1: Write failing tests**
  - `sign-in-code.test.ts`: subject; the code appears in html and text; the "ignore this email" line; school name.
  - `email-code.int.test.ts` (Mailpit):
    - Request for a real owner → 202 `{ maskedEmail }`; an email arrives with a 6-digit code; `CODE_REQUESTED` is recorded; verify with it → 200, cookie, `email_verified_at` set (seed it null), `SIGN_IN_SUCCEEDED` with `EMAIL_CODE`; the same code again → 401.
    - Request for an unknown email, a revoked member, and a suspended school → the same 202 body; no email within 2 s (Mailpit search empty).
    - A second request within 60 s sends nothing; after advancing the stored last-send time (rewrite the Redis key) a new code arrives and the old one → 401.
    - 5 wrong codes → the right code is then 401.
    - `code: '482 913'` style input is accepted (send the real code with a space inserted).
    - Job data in Redis never contains the code (inspect the `auth` queue's completed/failed jobs and the email job: the email job is removed on completion; assert the `send-code` job data has only `schoolCode` and `email`).
    - A paused password identifier can still sign in by code, and the pause remains afterwards.
    - With Redis stopped (last test in the file, as in `redis-outage.int.test.ts`): request → 503 problem+json within 3 s.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** per spec section 6, "Email code rules". The code comes from `crypto.randomInt(0, 1_000_000)` padded to 6 digits; the Redis value is JSON `{ hash, attemptsLeft }` with a 600 s TTL; attempt decrement and delete happen in one `MULTI` or a small Lua script so parallel guesses cannot exceed 5.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `feat(api): sign in with an emailed code`

---

### Task 8: Forgot and reset password

**Files:**

- Create: `apps/api/src/modules/auth/password-reset.service.ts`, `password-reset.processor.ts` (or a branch in one `AuthProcessor` for the `auth` queue; one processor class per queue is the existing pattern, so extend `email-code.processor.ts` into `auth.processor.ts` dispatching on `job.name`), `password.controller.ts`, `apps/api/src/core/email/templates/password-reset.ts` (+ test)
- Test: `apps/api/test/auth/password-reset.int.test.ts`

**Interfaces:**

- Consumes: `randomToken`, `sha256`, `checkPasswordPolicy`, `PasswordService`, `SessionService.revokeAllForUser`.
- Produces: `PasswordResetService.request({ identifier })`, `processSend(data)`, `reset({ token, newPassword }, meta)`; `passwordResetEmail({ link, minutes: 30 })`; `POST /auth/password/forgot` (202, `PASSWORD_RESET_THROTTLER`), `POST /auth/password/reset` (204; 410 one response; 400 with `errors: [{ path: 'newPassword', code: PasswordIssue }]`). A helper `policyErrors(issues): ValidationProblem` shared with Task 9.

- [ ] **Step 1: Write failing tests**
  - Template test: link and the 30-minute line in html and text.
  - Integration:
    - Forgot by email and by mobile → 202; the email goes to the account email; the link is `${WEB_ORIGIN}/en/reset-password?token=…`.
    - Unknown identifier and a user whose only school is suspended → same 202, no email.
    - A 4th request in an hour sends nothing.
    - Two requests → the first link's token → 410, the second works.
    - Reset → 204; all the user's sessions revoked with `PASSWORD_RESET`; sign-in with the new password works; `email_verified_at` set; `PASSWORD_RESET` recorded; the same token again → 410.
    - Policy: `password1234` → 400 with `path: 'newPassword'`; a password containing the school code of **any** of the user's schools → 400.
    - The token is not in the Redis value (only its hash in the key).

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per spec section 7 (`GETDEL` for single use). **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `feat(api): reset a forgotten password by email`

---

### Task 9: My account endpoints

**Files:**

- Create: `apps/api/src/modules/auth/account.service.ts`, `account.controller.ts`
- Test: `apps/api/test/auth/account.int.test.ts`

**Interfaces:**

- Produces: `GET /me` → `Me` (`id, name, email, emailVerified: boolean, mobile, hasPassword`); `PATCH /me` → `Me` (409 `errors: [{ path: 'mobile' }]`, 429 after 20 per hour per user via a Redis counter); `PUT /me/password` → 204 (400 `currentPassword` / policy errors; 403 `type: 'recent-sign-in-required'`).

- [ ] **Step 1: Write failing tests**
  - `GET /me` signed in → matches `meSchema`; signed out → 401.
  - `PATCH /me` name and mobile (`98765 43210` stored as `+919876543210`); `mobile: null` clears; a mobile held by another user → 409; the 21st change in an hour → 429.
  - First password set: with a session `authenticatedAt` 5 minutes ago → 204, `PASSWORD_SET`, other sessions revoked with `PASSWORD_CHANGED`, the current session still works; with `authenticatedAt` 11 minutes ago → 403 `recent-sign-in-required`.
  - Change: missing or wrong `currentPassword` → 400 `path: 'currentPassword'`, and 5 wrong ones pause password sign-in for the user's email at that school; correct → 204, `PASSWORD_CHANGED`.
  - Policy errors as in Task 8.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, then the whole API suite: `pnpm --filter @classloom/api test && pnpm --filter @classloom/api test:int`.

- [ ] **Step 5: Commit** `feat(api): add the my-account endpoints`

---

### Task 10: Web plumbing: proxy, real session, route protection

**Files:**

- Modify: `apps/web/next.config.ts` (rewrite), `packages/api-client/src/fetcher.ts` (+ test), regenerate `packages/api-client/src/generated` (`pnpm --filter @classloom/api-client generate`), `apps/web/src/proxy.ts`, `apps/web/src/app/[locale]/(app)/layout.tsx`, `dashboard/page.tsx`, `components/shell/app-shell.tsx`, `user-menu.tsx`, `components/providers.tsx`, `apps/web/src/lib/sw-cache-rules.test.ts`, `apps/web/playwright.config.ts`, `.github/workflows/ci.yml` only if env is needed beyond `.env.example`
- Create: `apps/web/src/lib/auth-redirect.ts` (+ test), `lib/session.ts` (+ test), `lib/server-session.ts`, `apps/web/e2e/auth.setup.ts`, `apps/web/e2e/support/school.ts`
- Delete: `apps/web/src/lib/mock-session.ts`

**Interfaces:**

- Consumes: Orval hooks for the auth endpoints; `safeNextPath` (Task 1).
- Produces:
  - Fetcher base: browser → `` `${window.location.origin}/api` ``; server → `process.env.API_INTERNAL_URL ?? 'http://localhost:4000'`; URLs are joined by concatenation (`base + url`), because `new URL('/auth/x', 'http://h/api')` would drop `/api`. `credentials: 'same-origin'`.
  - `isPublicPath(pathname: string): boolean` (after the locale: `sign-in`, `forgot-password`, `reset-password`, `register-school` and below, `terms`, `privacy`); `signInRedirect(pathname: string, search: string, locale: string): string`.
  - `getServerSession(): Promise<AuthSession | null>` (server-only; fetches `${API_INTERNAL_URL}/auth/session` with the incoming `cookie` header, `cache: 'no-store'`).
  - `toShellSession(session: AuthSession, navPermissions: string[]): ShellSession` (`OWNER` → `role: 'admin'`, all nav permissions, `campus` from the session, `academicYear` from `academicYearOf(new Date())`); `Role` type moves to `lib/session.ts`.
  - E2E: `createVerifiedSchool(request, opts?): Promise<{ code; email; mobile; name }>` (registration API + Mailpit verify link + verify API); `signInWithCode(request, school): Promise<void>` (through `/api/auth/otp/*` on the web origin so the cookie lands in the context); setup project `auth-setup` writing `e2e/.auth/owner.json` (git-ignored).

- [ ] **Step 1: Write failing tests**
  - `fetcher.test.ts`: in a jsdom window at `http://localhost:3200`, `apiFetch({ url: '/auth/session' })` calls `http://localhost:3200/api/auth/session` with `credentials: 'same-origin'`; with `window` undefined and `API_INTERNAL_URL=http://api:4000` it calls `http://api:4000/auth/session`.
  - `auth-redirect.test.ts`: `/en/dashboard` not public, `/en/sign-in` and `/en/register-school/verify` public; `signInRedirect('/en/students', '?q=1', 'en')` → `/en/sign-in?next=%2Fen%2Fstudents%3Fq%3D1`.
  - `session.test.ts`: `toShellSession` maps `OWNER` to `admin` with every permission and the session's campus name.
  - `providers` 401 handling: a unit test on an exported `onQueryError(error, router, pathname)` that redirects to `signInRedirect(...)` only for `ApiError` with status 401.
  - `sw-cache-rules.test.ts`: `/api/auth/session` is not cacheable.

- [ ] **Step 2: Run** `pnpm --filter @classloom/web test && pnpm --filter @classloom/api-client test` → FAIL.

- [ ] **Step 3: Implement**
  - Rewrite: `{ source: '/api/:path*', destination: `${process.env.API_INTERNAL_URL ?? 'http://localhost:4000'}/:path*` }`. Rewrites are fixed at build time, so `API_INTERNAL_URL`must be set when building (note it in`.env.example` and the README deploy notes).
  - `proxy.ts`: before `next-intl`, if the path (after locale) is not public and there is no `cl_session`/`__Host-cl_session` cookie, redirect to `signInRedirect`. The matcher already excludes `/api`.
  - `(app)/layout.tsx`: `getServerSession()`; null → `redirect(signInRedirect(...))` using the request path from `headers()` (`x-pathname` set by `proxy.ts`).
  - User menu: "My account" links to `/[locale]/account`; "Sign out" calls the sign-out mutation, `queryClient.clear()`, then `router.replace('/[locale]/sign-in')`.
  - Playwright: add project `auth-setup` (`testMatch: /auth\.setup\.ts/`), make the six device projects depend on it with `storageState: 'e2e/.auth/owner.json'`; web server readiness URL → `/en/sign-in`; API web server env adds `SIGN_IN_RATE_LIMIT_PER_15_MIN: '10000'`, `CODE_REQUEST_RATE_LIMIT_PER_HOUR: '10000'`, `PASSWORD_RESET_RATE_LIMIT_PER_HOUR: '10000'`. `school-registration.spec.ts` opts out with `test.use({ storageState: { cookies: [], origins: [] } })`.
  - Verify forwarding once: run the API with `debug` logging, request `http://localhost:3000/api/health` through `next start`, and check whether `x-forwarded-for` reaches the API. Record the result (and whether `TRUST_PROXY=loopback` yields the browser address) in `docs/superpowers/followups/2026-10-27-tenancy.md` under "For deployment".

- [ ] **Step 4: Run** unit tests → PASS; `pnpm build`; then the existing E2E suite on desktop Chrome: `E2E_WEB_PORT=3200 pnpm --filter @classloom/web exec playwright test --project=desktop-chrome` → the shell, a11y and registration specs pass signed in.

- [ ] **Step 5: Commit** `feat(web): proxy the API same-site and use the real session`

---

### Task 11: Auth UI components

**Files:**

- Create: `packages/ui/src/components/ui/input-otp.tsx` (`pnpm dlx shadcn@latest add input-otp` in `packages/ui`, then adapt to the project's tokens), `packages/ui/src/components/password-input.tsx`, `password-rules.tsx`, `auth-card.tsx` (+ `*.test.tsx`), `packages/ui/src/stories/auth.stories.tsx`

**Interfaces:**

- Produces:
  - `InputOTP`, `InputOTPGroup`, `InputOTPSlot` (shadcn API; the real input has `inputMode="numeric"`, `autoComplete="one-time-code"`, `pattern` digits only).
  - `PasswordInput(props: InputProps & { showLabel: string; hideLabel: string })`: toggle button with `aria-pressed`, 44 px under `pointer-coarse:`.
  - `PasswordRules({ rules }: { rules: { label: string; met: boolean }[] })`: a list whose items expose state to screen readers ("met"/"not met" text, not colour only).
  - `AuthCard({ title, description?, children, footer? })`: the Figma card (max-width 440 px, logo above, soft primary glow, copyright below).

- [ ] **Step 1: Write failing tests**: `PasswordInput` toggles `type` between `password` and `text` and flips `aria-pressed`; `PasswordRules` renders each rule with an accessible met/not-met state; `AuthCard` renders the title as `h1`.
- [ ] **Step 2: Run** `pnpm --filter @classloom/ui test` → FAIL.
- [ ] **Step 3: Implement**, plus stories: OTP empty/filled/error, password hidden/shown, rules none/some/all met, card on light and dark.
- [ ] **Step 4: Run** tests → PASS; `pnpm --filter @classloom/ui build-storybook` succeeds.
- [ ] **Step 5: Commit** `feat(ui): add OTP input, password input, password rules and auth card`

---

### Task 12: Sign-in, forgot and reset pages

**Files:**

- Create: `apps/web/src/app/[locale]/(auth)/layout.tsx`, `sign-in/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx`; `apps/web/src/features/auth/sign-in-flow.tsx`, `school-step.tsx`, `credentials-step.tsx`, `code-step.tsx`, `use-remembered-school.ts` (+ test), `use-countdown.ts` (+ test), `password-rule-list.ts` (+ test), `forgot-password-form.tsx`, `reset-password-form.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/src/features/school-registration/verify-result.tsx` (+ `verify-copy.test.ts`, and any `school-registration.spec.ts` assertion on the old "sign-in arrives soon" copy), `apps/web/e2e/a11y.spec.ts` (add the new public pages with an empty storage state)

**Interfaces:**

- Consumes: Task 10 hooks and helpers; Task 11 components; `getPublicSchool`, auth mutations.
- Produces:
  - `useRememberedSchool(): { code: string | null; remember(code: string): void; forget(): void }` (key `classloom.schoolCode`; `localStorage` access wrapped in try/catch).
  - `useCountdown(expiresAt: number): { secondsLeft: number; expired: boolean }`.
  - `passwordRuleList(password: string, t): { label; met }[]` for the client-side rules (length 10–128; the server-only checks are reported after submit).

- [ ] **Step 1: Write failing tests**: `useRememberedSchool` reads and writes the key and survives a throwing `localStorage`; `useCountdown` reaches `expired` at 0 with fake timers; `passwordRuleList` marks length met at 10 and unmet at 129; verify-copy test: the success state has a "Sign in" link to `/en/sign-in?school=GISD`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** spec section 6 (three steps, exact copy, `?school=` and remembered code, "Email me a sign-in code" disabled for mobiles with the hint, auto-submit on the 6th digit, resend disabled for 60 s, `aria-live` only for expiry, `safeNextPath` after sign-in) and section 7 (forgot: one uniform answer; reset: token stripped with `history.replaceState`, kept in state, spent only on submit, 410 view). `(auth)/layout.tsx` redirects to the dashboard when `getServerSession()` returns a session. Error mapping: 401 → incorrect; 429 `sign-in-paused` → paused copy; other 429 → network copy.
- [ ] **Step 4: Run** unit tests → PASS; `pnpm --filter @classloom/web build`.
- [ ] **Step 5: Commit** `feat(web): add sign-in, forgot-password and reset-password pages`

---

### Task 13: My account page

**Files:**

- Create: `apps/web/src/app/[locale]/(app)/account/page.tsx`, `apps/web/src/features/account/profile-form.tsx`, `password-form.tsx`, `recent-sign-in.ts` (+ test)
- Modify: `apps/web/messages/en.json`, `apps/web/src/config/nav.ts` only if the user menu needs a route constant

**Interfaces:**

- Consumes: `GET/PATCH /me`, `PUT /me/password` hooks; `PasswordInput`, `PasswordRules`.
- Produces: `isRecentSignInRequired(error: unknown): boolean` (an `ApiError` 403 with `type` ending `recent-sign-in-required`).

- [ ] **Step 1: Write failing tests**: `isRecentSignInRequired` true only for that problem type.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** spec section 8. On `recent-sign-in-required`, navigate to `/[locale]/sign-in?school=<code>&next=/[locale]/account&reauth=1`; with `reauth=1` the sign-in flow opens on the code step pre-filled with the user's email (from the session) and sends the code automatically once. Field errors from `409`/`400 errors[]` land on their fields; success shows a toast.
- [ ] **Step 4: Run** → PASS; `pnpm --filter @classloom/web build`.
- [ ] **Step 5: Commit** `feat(web): add the my-account page`

---

### Task 14: End-to-end journey across devices

**Files:**

- Create: `apps/web/e2e/auth.spec.ts`
- Modify: `apps/web/e2e/a11y.spec.ts` (sign-in steps, forgot, reset, account), `apps/web/e2e/shell.spec.ts` (sign-out from the user menu), `docs/superpowers/followups/` (new file `2026-10-27-auth-sign-in.md` for anything deferred during the build)

**Interfaces:**

- Consumes: `createVerifiedSchool`, `signInWithCode`, `latestEmailTo` (E2E support).

- [ ] **Step 1: Write the tests** (each with an empty storage state unless it needs the shared owner):
  - **Journey:** create a verified school with a mobile → open `/en/register-school/verify` success "Sign in" → school step pre-filled → "Email me a sign-in code" → read the code from Mailpit → type it → dashboard shows the owner's name and school → My account → set a password → sign out → sign in with the **mobile** and the password → dashboard → sign out → Forgot password with the email → open the link → set a new password → sign in with it.
  - **Protected page:** `/en/students` signed out → sign-in with `next` → after code sign-in, lands on `/en/students`.
  - **Wrong password** shows "Email/mobile or password is incorrect."
  - **Two tabs:** two pages in one context; sign out in the first; trigger a client query in the second (navigate within the app) → sign-in page.
  - **Keyboard only** (desktop projects): complete the code step with Tab/typing/Enter.
  - **Overflow:** no horizontal scroll at the 375 px projects on sign-in (all steps), forgot, reset and account.
  - **axe** light and dark on sign-in (school, credentials, code steps), forgot, reset (form and 410 view) and account.
- [ ] **Step 2: Run** on all projects: `pnpm build && E2E_WEB_PORT=3200 pnpm --filter @classloom/web exec playwright test` → fix until 0 failed.
- [ ] **Step 3: Run the full suite:** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int` → all pass.
- [ ] **Step 4: Commit** `test(web): cover sign-in, passwords and sessions end to end`
