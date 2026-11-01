# Auth: security settings (Phase 1, Part 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People can turn on authenticator-app two-step sign-in with recovery codes, trust a device for 30 days, see and end their sessions, read their sign-in history, and get security emails.

**Architecture:** The existing `auth` module gains a TOTP and recovery-code layer, a known-device service keyed by a `cl_device` cookie, and a Redis challenge between the first factor and the session. Part 2a's two first-factor endpoints answer 202 with a challenge when the second step is due; a new verify endpoint finishes the sign-in. New `/me/*` endpoints serve the Security page, which the web app adds as a tab of My account.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL 17, Redis, `otplib`, `bowser`, Node `crypto` (AES-256-GCM), Next.js 16, `qrcode`, shadcn/ui, Vitest, Testcontainers, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-11-01-auth-security-design.md` (section numbers below refer to it). Part 2a's spec and code are the base: `docs/superpowers/specs/2026-10-27-auth-sign-in-design.md`, `apps/api/src/modules/auth/*`.

## Global Constraints

- Branch `feat/p1-auth-security` from `main` after PR #7 merges; Conventional Commits with the harness's Co-Authored-By trailer; one PR against `main`.
- New dependencies pinned exactly: `otplib`, `bowser` (API); `qrcode` + `@types/qrcode` (web). Any build script goes in `allowBuilds`.
- New tables `recovery_codes`, `known_devices` are platform-level (no RLS) and go into `PLATFORM_MODELS_WITH_TENANT_FK` only if they carry `tenantId` (they don't; they are user-level).
- Fixed values (spec §4–§11):
  - TOTP: SHA-1, 6 digits, 30-second period, accept ±1 step, refuse a step ≤ `totp_last_step`. Secret 20 random bytes, base32.
  - `otpauthUrl` = `otpauth://totp/Classloom:{email}?secret={secret}&issuer=Classloom&digits=6&period=30&algorithm=SHA1` (email URL-encoded).
  - Recovery codes: 10 codes, 10 characters from Crockford base32, shown `XXXXX-XXXXX`; stored as HMAC-SHA-256 with `AUTH_SECRET` of the normalised code (uppercase, spaces and hyphens removed).
  - Encryption: AES-256-GCM, 12-byte random IV, stored `iv ‖ tag ‖ ciphertext`, key `TOTP_ENCRYPTION_KEY` (base64 of exactly 32 bytes, required; production refuses the `.env.example` value).
  - Challenge: 32 random bytes, Redis key `auth:2fa:{sha256}`, TTL 300 s, 5 attempts. Setup secret: `auth:2fa-setup:{userId}`, TTL 600 s.
  - Trust: 30 days. Device cookie: `__Host-cl_device` when `COOKIE_SECURE`, else `cl_device`; 32 random bytes; `HttpOnly; SameSite=Lax; Path=/`; `Max-Age` 1 year.
  - Per-user wrong two-step codes: 5 per 15 minutes → `429`, `type: two-factor-paused`. `/me/sessions/*` and `/me/devices/*` mutations: 30 per hour per user.
  - History: 20 per page, newest first, past 365 days, keyset cursor on `(created_at, id)`. Devices not seen for 365 days are deleted by the daily auth clean-up.
- Problem types introduced: `two-factor-expired`, `two-factor-invalid` (body adds `attemptsLeft`), `two-factor-paused`.
- operationIds: `verifyTwoFactor`, `startTwoFactorSetup`, `enableTwoFactor`, `regenerateRecoveryCodes`, `disableTwoFactor`, `listMySessions`, `revokeMySession`, `revokeMyOtherSessions`, `listMyDevices`, `untrustMyDevice`, `listMyLoginActivity`, plus `getTwoFactorStatus` (see Task 6).
- Every enable/disable/regenerate/setup endpoint requires a recent sign-in (10 minutes) via Part 2a's `RecentSignInRequiredException`.
- No secret, raw challenge, raw recovery code or device cookie value in logs, Redis values, job data or `auth_events`.
- The three new emails go through `EmailService.enqueue` with `keepFailedSeconds: 86400` (they hold no secret).
- All web copy in `apps/web/messages/en.json`, all email copy in `apps/api/messages/en.json`; new screens pass axe WCAG 2.1 AA in light and dark on the 6 device projects with no overflow at 375 px; 44 px touch targets.
- A dev API may hold :4000 locally: run E2E with `E2E_API_PORT=4100 E2E_WEB_PORT=3200` and a web build made with `API_INTERNAL_URL=http://localhost:4100`.

## Review Focus

1. **Codes as people type them.** `482 913` (space) for the app code and `abcde fghij` / `ABCDEFGHIJ` / `abcde-fghij` for a recovery code must all work (Task 3 tests).
2. **One code, two tabs.** Two parallel verifies with the same valid app code produce exactly one session (Task 5 test).
3. **Two schools, one person.** Trust is per user and device, so trusting a device while signing in to school A also skips the step at school B (Task 5 test); the sessions list shows both schools (Task 7 test).
4. **Password reset during a pending challenge.** The later verify gets 401 and no session (Task 5 test).
5. **Cookies cleared.** A browser without `cl_device` is treated as new every time: the step is asked and the email sent, with no error (Task 5 test).

---

## File structure

```
packages/contracts/src/two-factor.ts (+ test)       challenge, verify, setup/enable/disable, sessions, devices, activity schemas
apps/api/src/core/config/env.schema.ts (+ test)     TOTP_ENCRYPTION_KEY
apps/api/prisma/schema/{auth,tenancy}.prisma        user columns, RecoveryCode, KnownDevice, enum values
apps/api/prisma/migrations/<ts>_auth_security/
apps/api/src/modules/auth/
  secret-box.ts (+ test)          encryptSecret / decryptSecret
  totp.ts (+ test)                generateTotpSecret, otpauthUrl, matchTotpStep
  recovery-codes.ts (+ test)      generateRecoveryCodes, normaliseRecoveryCode, hashRecoveryCode
  device-label.ts (+ test)        deviceLabel(userAgent)
  device-cookie.ts (+ test)       device cookie helpers
  known-device.service.ts         find, recordSignIn, trust, untrust, clearTrustForUser
  two-factor-challenge.service.ts Redis challenge create/take/attempt
  two-factor.service.ts           user-facing setup/enable/regenerate/disable + verifyForUser
  two-factor-sign-in.service.ts   completeFirstFactor + verifyChallenge
  two-factor.controller.ts        POST /auth/two-factor/verify
  security.controller.ts          /me/two-factor/*, /me/sessions*, /me/devices*, /me/login-activity
  security.service.ts             sessions, devices, history queries
apps/api/src/core/email/templates/{new-device,password-changed,two-factor-changed}.ts (+ tests)
apps/api/src/cli/users.commands.ts                  users:disable-2fa
apps/web/src/features/auth/two-factor-step.tsx
apps/web/src/features/security/*                   page sections and dialogs
apps/web/src/app/[locale]/(app)/account/security/page.tsx, account tabs
apps/web/e2e/security.spec.ts, e2e/support/totp.ts
```

---

### Task 1: Configuration, contracts and the secret box

**Files:**

- Modify: `apps/api/src/core/config/env.schema.ts` (+ test), `apps/api/test/setup-containers.ts`, `.env.example`, `apps/api/package.json`, `apps/web/package.json` (dependencies only)
- Create: `packages/contracts/src/two-factor.ts` (+ test, export from `index.ts`), `apps/api/src/modules/auth/secret-box.ts` (+ test)

**Interfaces:**

- Produces:
  - `Env.TOTP_ENCRYPTION_KEY: Buffer` (parsed from base64, exactly 32 bytes; in production the `.env.example` value is refused).
  - `encryptSecret(key: Buffer, plaintext: string): Buffer`, `decryptSecret(key: Buffer, box: Buffer): string` (throws on tamper).
  - Contracts: `twoFactorChallengeSchema` (`{ twoFactorRequired: true, challenge, expiresAt }`), `twoFactorVerifyRequestSchema` (`{ challenge, code?, recoveryCode?, trustDevice }`, exactly one of code/recoveryCode; `code` strips spaces and must be 6 digits), `twoFactorSetupSchema` (`{ secret, otpauthUrl }`), `twoFactorCodeRequestSchema` (`{ code }`), `twoFactorDisableRequestSchema` (`{ code?, recoveryCode? }`, exactly one), `recoveryCodesSchema` (`{ recoveryCodes: string[] }` length 10), `twoFactorStatusSchema` (`{ enabled, enabledAt: string | null, recoveryCodesLeft: number }`), `mySessionSchema`, `mySessionsSchema`, `myDeviceSchema`, `myDevicesSchema`, `loginActivityEventSchema`, `loginActivityPageSchema` (fields per spec §8).
  - `normaliseRecoveryCode` lives in Task 3; the contract only trims and caps `recoveryCode` at 20 characters.

- [ ] **Step 1: Failing tests.** Env: missing key, a 31-byte key and non-base64 are reported; a 32-byte key parses to a 32-byte `Buffer`; `NODE_ENV=production` with the `.env.example` value is refused. Secret box: round trip; two encryptions of one value differ; flipping one byte of the tag or ciphertext throws. Contracts: `'482 913'` → `'482913'`; both or neither of code/recoveryCode → error; `recoveryCodes` of 9 → error.
- [ ] **Step 2: Run** `pnpm --filter @classloom/api test env.schema secret-box && pnpm --filter @classloom/contracts test two-factor` → FAIL.
- [ ] **Step 3: Implement.** Add `otplib`, `bowser` to the API and `qrcode`, `@types/qrcode` to the web app now (exact versions) so later tasks only import. `.env.example`: `TOTP_ENCRYPTION_KEY=` a fixed dev base64 value with a "dev only" comment; `setup-containers.ts` gets a random 32-byte key.
- [ ] **Step 4: Run** → PASS; `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(contracts): add two-factor contracts, key config and secret box`

---

### Task 2: Schema and migration

**Files:**

- Modify: `apps/api/prisma/schema/tenancy.prisma` (User), `apps/api/prisma/schema/auth.prisma`
- Create: `apps/api/prisma/migrations/<ts>_auth_security/migration.sql`
- Test: `apps/api/test/auth/security-schema.int.test.ts`

**Interfaces:**

- Produces: `User.totpSecretEnc Bytes?`, `User.totpEnabledAt DateTime?`, `User.totpLastStep BigInt?`; model `RecoveryCode { id, userId, codeHash String, usedAt DateTime?, createdAt }` (`@@unique([userId, codeHash])`, cascade); model `KnownDevice { id, userId, deviceHash Bytes, label String, firstSeenAt, lastSeenAt, trustedUntil DateTime? }` (`@@unique([userId, deviceHash])`, `@@index([lastSeenAt])`, cascade); `AuthEventType` + `TWO_FACTOR_SUCCEEDED, TWO_FACTOR_FAILED, RECOVERY_CODE_USED, TWO_FACTOR_ENABLED, TWO_FACTOR_DISABLED, RECOVERY_CODES_REGENERATED, DEVICE_TRUSTED, DEVICE_UNTRUSTED, SESSION_REVOKED`; `AuthMethod` + `RECOVERY_CODE`; `SessionRevokedReason` + `REVOKED_BY_USER, TWO_FACTOR_DISABLED`.

- [ ] **Step 1: Failing test:** the unique constraints hold; deleting a user cascades both tables; the app role can read and write both tables (as in Part 2a's schema test).
- [ ] **Step 2: Run** `pnpm --filter @classloom/api exec vitest run -c vitest.int.config.ts security-schema` → FAIL.
- [ ] **Step 3: Implement.** Hand-check the generated SQL; `ALTER TYPE … ADD VALUE` statements must not run inside a transaction block with other use of the new values.
- [ ] **Step 4: Run** the file → PASS; then the full `pnpm --filter @classloom/api test:int` once.
- [ ] **Step 5: Commit** `feat(api): add two-factor, recovery code and device tables`

---

### Task 3: TOTP, recovery codes and device labels

**Files:**

- Create: `apps/api/src/modules/auth/totp.ts`, `recovery-codes.ts`, `device-label.ts` (+ unit tests each)

**Interfaces:**

- Produces:
  - `generateTotpSecret(): string` (base32 of 20 random bytes); `otpauthUrl(email: string, secret: string): string`; `matchTotpStep(secret: string, code: string, now: Date, lastStep: bigint | null): bigint | null` — returns the accepted time step (current ±1) or null; null for a step ≤ `lastStep`.
  - `generateRecoveryCodes(): string[]` (10 codes, `XXXXX-XXXXX`); `normaliseRecoveryCode(input: string): string`; `hashRecoveryCode(secret: string, normalised: string): string` (hex).
  - `deviceLabel(userAgent: string | null): string` — "{Browser} on {OS}" via `bowser`, "Unknown device" when absent or unparseable.

- [ ] **Step 1: Failing tests.**
  - TOTP with fixed secret and `now`: the current code → its step; codes for step −1 and +1 accepted; −2 and +2 → null; a code at `lastStep` → null; `otpauthUrl('a+b@x.in', S)` encodes the email and has every parameter from Global Constraints. Verify one code against RFC 6238's SHA-1 test vector (secret `12345678901234567890`, T = 59 s → `287082`, 6-digit).
  - Recovery codes: 10 unique codes matching `/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/`; `normaliseRecoveryCode(' abcde-fghjk ')` → `'ABCDEFGHJK'`, and `'abcde fghjk'` gives the same; `hashRecoveryCode` is stable and differs per secret.
  - Device label: Chrome/Windows, Safari/iPhone (`'Safari on iOS'`), Firefox/Android UA strings; `null` → `'Unknown device'`.
- [ ] **Step 2: Run** `pnpm --filter @classloom/api test totp recovery-codes device-label` → FAIL.
- [ ] **Step 3: Implement** with `otplib`'s `authenticator`/`totp` primitives configured to the Global Constraints values; compute steps explicitly (`floor(epochSeconds / 30)`) so replay can be checked.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): add TOTP, recovery code and device label helpers`

---

### Task 4: Device cookie and known devices

**Files:**

- Create: `apps/api/src/modules/auth/device-cookie.ts` (+ test), `known-device.service.ts`
- Modify: `session.service.ts` (`changePassword` clears trust in its transaction), `auth-cleanup.processor.ts` or its service (delete devices not seen for 365 days), `auth.module.ts`
- Test: `apps/api/test/auth/known-devices.int.test.ts`

**Interfaces:**

- Consumes: `deviceLabel` (Task 3), `sha256` (`crypto.ts`), `sessionCookieName` pattern (`session-cookie.ts`).
- Produces:
  - `deviceCookieName(env)`, `readDeviceToken(req, env): string | undefined`, `ensureDeviceToken(req, res, env): string` (reads the cookie or sets a new one; always re-sets `Max-Age` 1 year).
  - `KnownDeviceService`: `find(userId, deviceToken): Promise<KnownDevice | null>`; `isTrusted(device: KnownDevice | null, now): boolean`; `recordSignIn(userId, deviceToken, userAgent, opts: { trust: boolean }, now?): Promise<{ device: KnownDevice; isNew: boolean }>` (upsert; `trusted_until` = now + 30 d when `trust`); `untrust(userId, deviceId): Promise<boolean>` (false when not the user's); `clearTrustForUser(userId, tx?)`.

- [ ] **Step 1: Failing tests.** Cookie helpers: names per `COOKIE_SECURE`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` 31,536,000, no `Domain`. Integration: first `recordSignIn` → `isNew: true` with the parsed label; second → `isNew: false`, `last_seen_at` moved; `trust: true` sets `trusted_until` ≈ now + 30 d; `isTrusted` false after expiry; `untrust` of another user's device → false; `changePassword` clears every `trusted_until` of the user; clean-up deletes a device last seen 366 days ago and keeps one seen 364 days ago. Only the hash of the device token is stored.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, including Part 2a's session and password-reset int files.
- [ ] **Step 5: Commit** `feat(api): recognise devices and clear trust on password changes`

---

### Task 5: Two-step at sign-in

**Files:**

- Create: `two-factor-challenge.service.ts`, `two-factor-sign-in.service.ts`, `two-factor.controller.ts`, `apps/api/src/core/email/templates/new-device.ts` (+ test)
- Modify: `password-sign-in.service.ts`, `email-code.service.ts`, `sign-in.controller.ts` (202 branch, device cookie), `auth.module.ts`, `apps/api/messages/en.json`
- Test: `apps/api/test/auth/two-factor-sign-in.int.test.ts`

**Interfaces:**

- Consumes: Tasks 1–4; `SessionService.create` (pass `passwordChangedAt`), `AuthEventsService.record`, `SignInPauseService` pattern for the per-user counter, `EmailService.enqueue`.
- Produces:
  - `TwoFactorChallengeService`: `create(data: ChallengeData): Promise<{ challenge: string; expiresAt: Date }>`; `attempt(challenge): Promise<ChallengeData | 'expired'>` (decrements atomically, deletes at 0); `consume(challenge): Promise<boolean>` (GETDEL). `ChallengeData = { userId, tenantId, membershipId, remember, method: 'PASSWORD' | 'EMAIL_CODE', passwordChangedAt: string | null }`.
  - `TwoFactorSignInService.completeFirstFactor(first: FirstFactorResult, meta): Promise<{ kind: 'session'; token; session: AuthSession; remember } | { kind: 'challenge'; body: TwoFactorChallenge }>` — the single place both first factors hand over to. `FirstFactorResult = { user, tenant, membership, remember, method }`.
  - `TwoFactorSignInService.verifyChallenge(input: TwoFactorVerifyRequest, meta): Promise<{ token; session: AuthSession; remember }>`.
  - `verifyCodeForUser(user, input: { code?: string; recoveryCode?: string }, now?): Promise<'APP' | 'RECOVERY' | null>` in `two-factor.service.ts` (used here and by Task 6); updates `totp_last_step` / `used_at` with conditional updates.
  - `newDeviceEmail({ schoolName, device, ip, at, securityUrl })`.
  - Sign-in endpoints respond 202 + `TwoFactorChallenge` when due (OpenAPI declares both 200 and 202).

- [ ] **Step 1: Failing tests** (integration, with a user who has two-step on; compute codes with `otplib` from the stored secret):
  - Password sign-in → 202 with `challenge`, no session row, no session cookie, a device cookie set; code sign-in → 202 the same way.
  - Verify with a valid app code → 200 `AuthSession`, cookie, `TWO_FACTOR_SUCCEEDED`, session `authenticated_at` ≈ now; the same code again on a new challenge → 401 `two-factor-invalid` (replay).
  - Two parallel verifies of one challenge with a valid code → exactly one 200 (Review Focus 2).
  - Recovery code typed `abcde fghjk` style → 200 once, `RECOVERY_CODE_USED`, method `RECOVERY_CODE`; the same code again → 401.
  - 5 wrong codes → the challenge is gone (6th → 401 `two-factor-expired`); wrong codes across challenges: the 6th within 15 min → 429 `two-factor-paused`.
  - Expired challenge (TTL lapsed) → 401 `two-factor-expired`.
  - `trustDevice: true` → next sign-in from the same device cookie → 200 directly; the same device at the user's second school → 200 directly (Review Focus 3); after `changePassword` → 202 again.
  - Password reset between the 202 and the verify → 401, no session (Review Focus 4).
  - Two-step turned off (secret cleared) between the 202 and the verify → 401 `two-factor-expired`, no session.
  - New device: first completed sign-in from a device → one new-device email (Mailpit); a second sign-in from it → none; a failed two-step attempt never creates the device row; no device cookie at all → 202 and an email each time, no error (Review Focus 5).
  - Users without two-step: unchanged 200 behaviour (Part 2a's suites stay green).
  - Redis down → verify 503.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** spec §6. **Step 4: Run** → PASS, and the full API integration suite.
- [ ] **Step 5: Commit** `feat(api): ask for the authenticator code after the first sign-in step`

---

### Task 6: Turning two-step on and off, emails and the CLI reset

**Files:**

- Modify: `two-factor.service.ts` (add setup/enable/regenerate/disable/status beside Task 5's `verifyCodeForUser`)
- Create: `security.controller.ts` (the `/me/two-factor/*` routes), templates `password-changed.ts`, `two-factor-changed.ts` (+ tests), `apps/api/src/cli/users.commands.ts` (register in `cli.ts`)
- Modify: `session.service.ts` (`changePassword` enqueues the password-changed email after commit), `apps/api/messages/en.json`
- Test: `apps/api/test/auth/two-factor-settings.int.test.ts`, `apps/api/test/auth/cli-users.int.test.ts`

**Interfaces:**

- Produces: `GET /me/two-factor` → `TwoFactorStatus` (operationId `getTwoFactorStatus`); `POST /me/two-factor/setup|enable|recovery-codes|disable` per spec §7; `twoFactorChangedEmail({ change: 'ENABLED' | 'DISABLED' | 'CODES_REGENERATED', at, securityUrl })`; `passwordChangedEmail({ at, forgotUrl })`; CLI `users:disable-2fa <email> --reason <text>`.

- [ ] **Step 1: Failing tests:**
  - Setup without a recent sign-in → 403 `recent-sign-in-required`; with one → `{ secret, otpauthUrl }`; setup while enabled → 409.
  - Enable with a wrong code → 400; after the 10-minute setup TTL → 410; with a right code → 10 codes, `totp_enabled_at` set, secret stored encrypted (raw secret not in the row), `TWO_FACTOR_ENABLED`, email "turned on".
  - Status shows `recoveryCodesLeft` decreasing as codes are used.
  - Regenerate with an app code → 10 new codes; an old code no longer works; email.
  - Disable with a recovery code → 204; secret and codes cleared; trusted devices cleared; email "turned off".
  - Wrong codes on these endpoints count toward the per-user 5-per-15-minutes limit.
  - Password set, change and reset each send the password-changed email once.
  - CLI: clears two-step, codes and trust, revokes sessions with `TWO_FACTOR_DISABLED`, records `TWO_FACTOR_DISABLED`, sends the email; unknown email exits non-zero.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): turn two-step sign-in on and off, with security emails and a CLI reset`

---

### Task 7: Sessions, devices and history endpoints

**Files:**

- Create: `security.service.ts`; Modify: `security.controller.ts`
- Test: `apps/api/test/auth/security-lists.int.test.ts`

**Interfaces:**

- Produces: the six `/me/sessions*`, `/me/devices*`, `/me/login-activity` routes of spec §8 with the Global Constraints operationIds; cursor = base64url of `{createdAt ISO, id}`.

- [ ] **Step 1: Failing tests:** the sessions list holds only the user's live sessions across both their schools (with school names), marks `current`; revoking another session → 204, that session's cookie then gets 401 on `/auth/session`, `SESSION_REVOKED` recorded; revoking the current one → 400; another user's session id → 404; revoke-others leaves only the current one; devices list with `current` from the device cookie; untrust → 204, another user's device → 404; history pages of 20 with a working `nextCursor`, newest first, nothing older than 365 days, another user's events never appear; the 31st mutation in an hour → 429.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; regenerate the client (`pnpm --filter @classloom/api-client generate`) and commit it with this task.
- [ ] **Step 5: Commit** `feat(api): list and end sessions, devices and sign-in history`

---

### Task 8: Web: the two-step sign-in step

**Files:**

- Create: `apps/web/src/features/auth/two-factor-step.tsx`, `two-factor-errors.ts` (+ test)
- Modify: `sign-in-flow.tsx` (new phase `{ step: 'two-factor'; school; challenge; expiresAt }`; both first-factor submissions branch on 202), `credentials-step.tsx`, `code-step.tsx`, `messages/en.json`, `apps/web/e2e/a11y.spec.ts`

**Interfaces:**

- Consumes: generated `verifyTwoFactor` hook; `InputOTP`; Part 2a's `safeNextPath` redirect after sign-in.
- Produces: `twoFactorErrorOf(error: unknown): { key: 'invalid' | 'expired' | 'paused' | 'temporarilyUnavailable' | 'network' | 'generic'; attemptsLeft?: number }`.

- [ ] **Step 1: Failing tests:** `twoFactorErrorOf` maps 401 `two-factor-invalid` (with `attemptsLeft`), 401 `two-factor-expired`, 429 `two-factor-paused`, 503, network and other errors.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** spec §6 "Web: the code step" (exact copy; auto-submit with the Part 2a double-submit guard; the recovery-code toggle; "Start again"; trust checkbox unticked by default). Add the step to `a11y.spec.ts` (reach it by turning two-step on for a fresh user through the API with a code from `e2e/support/totp.ts`).
- [ ] **Step 4: Run** web unit tests, typecheck, lint, build, and `a11y.spec.ts` on desktop-chrome and pixel-7 → PASS.
- [ ] **Step 5: Commit** `feat(web): add the two-step sign-in step`

---

### Task 9: Web: the Security page

**Files:**

- Create: `apps/web/src/app/[locale]/(app)/account/security/page.tsx`, `apps/web/src/features/security/{two-factor-section,two-factor-setup-dialog,two-factor-code-dialog,sessions-section,devices-section,activity-section,recovery-codes-file}.tsx|ts` (+ tests for pure helpers), account tabs component used by both account pages
- Modify: `messages/en.json`, `apps/web/e2e/a11y.spec.ts`

**Interfaces:**

- Consumes: generated hooks from Task 7 and Task 6; `RecentSignInRequired` handling from Part 2a (`isRecentSignInRequired` → `reauthPath`).
- Produces: `recoveryCodesFile(codes: string[], email: string, createdAt: Date): string` (the downloaded text); `eventLabelKey(type, method): string` (i18n key per event).

- [ ] **Step 1: Failing tests:** `recoveryCodesFile` has a header line with the email and date and one code per line; `eventLabelKey` covers every `AuthEventType` value (a test iterates the enum from contracts so a new type fails the test).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** spec §9 (QR rendered with `qrcode` to a data URL client-side, key shown in groups of four with Copy; the "I've saved these codes" checkbox gates Done; dialogs return focus to their trigger; history as a table from `md` up and cards below; "Load more" with the cursor). A 403 `recent-sign-in-required` from any two-step action goes through Part 2a's reauth path and back to `/account/security`. Add the page and the open setup dialog to `a11y.spec.ts`.
- [ ] **Step 4: Run** web unit tests, typecheck, lint, build, `a11y.spec.ts` on desktop-chrome and pixel-7 → PASS.
- [ ] **Step 5: Commit** `feat(web): add the security settings page`

---

### Task 10: End-to-end across devices

**Files:**

- Create: `apps/web/e2e/security.spec.ts`, `apps/web/e2e/support/totp.ts` (if not created in Task 8)
- Modify: `docs/superpowers/followups/` (new `2026-11-01-auth-security.md`, header only; the controller fills it)

- [ ] **Step 1: Write the tests** (own school and session each, empty storage state): turn on two-step reading the shown key and computing codes in the test, tick "I've saved these codes", sign out, sign in through the app-code step, trust the device, sign out and in again without the step, change the password and see the step again, sign in with a recovery code, end another session from the list (a second context's cookie then lands on sign-in), read the history and load a second page, turn two-step off. Keyboard-only completion of the setup dialog on desktop projects. No overflow at narrow widths on the Security page and the two-step step.
- [ ] **Step 2: Run** all six projects; then `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int` → all pass.
- [ ] **Step 3: Commit** `test(web): cover two-step sign-in and security settings end to end`
