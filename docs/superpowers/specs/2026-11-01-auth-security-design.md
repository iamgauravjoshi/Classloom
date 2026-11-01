# Phase 1, Part 2b: Auth: security settings

Status: draft for review · Date: 2026-11-01 · Builds on: [Part 2a: sign-in and sessions](2026-10-27-auth-sign-in-design.md) · Research: [auth notes](../../research/auth.md) ("Security settings page")

## 1. Purpose

Part 2a lets people sign in and keeps them signed in. This part lets each person **protect and inspect their own account**:

- turn on two-step sign-in with an authenticator app;
- trust a device for 30 days;
- see and end their active sessions;
- read their sign-in history;
- receive emails when something security-relevant happens.

### Success criteria

- A person turns on two-step sign-in by scanning a QR code, saves 10 recovery codes, and from then on every sign-in (password or email code) asks for the app code.
- Ticking "Don't ask again on this device for 30 days" skips the step on that browser until the trust expires, is removed, or the password changes.
- A person can end any other session, and it is refused on its next request.
- The sign-in history shows the past year of their own events.
- New-device sign-in, password changes and two-step changes each send an email.
- A person who lost their phone and recovery codes can be let back in by the platform owner through the CLI.

### Decisions already made (with the user, 2026-11-01)

| Topic                      | Decision                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| When the app code is asked | After **every** first-factor sign-in (password or email code) when two-step is on                                           |
| Trusted devices            | Yes: "Don't ask again on this device for 30 days"                                                                           |
| Lost phone and codes       | The platform owner turns two-step off with a CLI command; a school-admin reset comes with Part 3 (IAM)                      |
| Security emails            | New-device sign-in; password set/changed/reset; two-step turned on/off and recovery codes regenerated. Not "account paused" |
| Who must use it            | Nobody is forced (Part 2a decision); a school-level policy comes with Part 3                                                |

## 2. Scope

**In scope**

- Authenticator-app two-step sign-in (TOTP), recovery codes, the sign-in challenge step.
- Device recognition, trusted devices, new-device emails.
- My account › Security page: two-step, active sessions, trusted devices, sign-in history.
- Security emails (above).
- CLI: `users:disable-2fa`.

**Out of scope**

- SMS or email as a second factor, passkeys, hardware keys (later).
- Location lookups (IP only, no geolocation).
- School-wide policy ("require two-step for admins"), admin views of other people's sessions or history, admin resets: **Part 3 (IAM)**.

## 3. Concepts

| Term                 | Meaning                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Two-step sign-in** | A second factor: a 6-digit code from an authenticator app (TOTP, RFC 6238), asked after the password or email code.               |
| **Challenge**        | A short-lived, single-purpose token issued after a correct first factor when the app code is still needed. No session exists yet. |
| **Recovery code**    | One of 10 single-use codes that replace the app code when the phone is unavailable.                                               |
| **Device**           | A browser identified by a long-lived random `cl_device` cookie. Recorded per user the first time they sign in from it.            |
| **Trusted device**   | A device on which the user ticked "Don't ask again…"; the app code is skipped there until `trusted_until`.                        |

## 4. Data model

Prisma schema: `apps/api/prisma/schema/auth.prisma` (extended). All new tables are platform-level (read before any tenant context exists), like `sessions`.

### User (`users`): new columns

| Column            | Type         | Rules                                                                                       |
| ----------------- | ------------ | ------------------------------------------------------------------------------------------- |
| `totp_secret_enc` | bytea?       | AES-256-GCM ciphertext (IV + tag + data) of the base32 secret; null when two-step is off    |
| `totp_enabled_at` | timestamptz? | Set when two-step is turned on; null when off                                               |
| `totp_last_step`  | bigint?      | The last accepted 30-second time step; a code from that step or earlier is refused (replay) |

### Recovery code (`recovery_codes`)

| Column      | Type         | Rules                                                  |
| ----------- | ------------ | ------------------------------------------------------ |
| `id`        | uuid         | PK                                                     |
| `user_id`   | uuid         | FK → users, cascade                                    |
| `code_hash` | text         | HMAC-SHA-256 of the normalised code with `AUTH_SECRET` |
| `used_at`   | timestamptz? | Single use                                             |

Unique `(user_id, code_hash)`. Regenerating deletes the user's rows and inserts 10 new ones.

### Known device (`known_devices`)

| Column          | Type         | Rules                                                                     |
| --------------- | ------------ | ------------------------------------------------------------------------- |
| `id`            | uuid         | PK                                                                        |
| `user_id`       | uuid         | FK → users, cascade                                                       |
| `device_hash`   | bytea        | SHA-256 of the `cl_device` cookie value                                   |
| `label`         | text         | "Chrome on Windows", parsed from the user agent at first sight (`bowser`) |
| `first_seen_at` | timestamptz  |                                                                           |
| `last_seen_at`  | timestamptz  | Updated on each successful sign-in from it                                |
| `trusted_until` | timestamptz? | Set to now + 30 days when trusted; null when not trusted                  |

Unique `(user_id, device_hash)`. Devices not seen for 1 year are deleted by the existing daily auth clean-up.

### Auth events: new types

`TWO_FACTOR_SUCCEEDED`, `TWO_FACTOR_FAILED`, `RECOVERY_CODE_USED`, `TWO_FACTOR_ENABLED`, `TWO_FACTOR_DISABLED`, `RECOVERY_CODES_REGENERATED`, `DEVICE_TRUSTED`, `DEVICE_UNTRUSTED`, `SESSION_REVOKED`. New method value `RECOVERY_CODE`. `SessionRevokedReason` gains `REVOKED_BY_USER` and `TWO_FACTOR_DISABLED`.

### Short-lived state in Redis

| Key                        | Value                                                                                      | TTL    |
| -------------------------- | ------------------------------------------------------------------------------------------ | ------ |
| `auth:2fa:{challengeHash}` | `{ userId, tenantId, membershipId, remember, method, passwordChangedAt, attemptsLeft: 5 }` | 5 min  |
| `auth:2fa-setup:{userId}`  | The pending secret, encrypted as in the table                                              | 10 min |

## 5. The device cookie

- Name `__Host-cl_device` when `COOKIE_SECURE`, else `cl_device`; value 32 random bytes base64url; `HttpOnly; SameSite=Lax; Path=/`; `Max-Age` 1 year, refreshed on each successful sign-in.
- Set by the API on any first-factor success if missing. Only its SHA-256 is stored.
- It identifies the browser, not the person: two people on one school computer share a device, but `known_devices` is per user, so each sees it as their own device.

## 6. Sign-in with two-step

Part 2a's first factors (`POST /auth/sign-in/password`, `POST /auth/otp/verify`) are unchanged up to the point where they would create a session. Then:

1. Look up (read only) the `known_devices` row for (user, device).
2. If the user has two-step on **and** the device is not trusted (`trusted_until` is null or past): create a challenge (32 random bytes; only its SHA-256 is the Redis key), record nothing as signed in, and return **202**:
   ```json
   { "twoFactorRequired": true, "challenge": "<raw token>", "expiresAt": "…" }
   ```
3. Otherwise create the session exactly as in Part 2a (200, `AuthSession`).
4. **Only when a session is created** (here or after the two-step verify): upsert the `known_devices` row (`last_seen_at`, label on first sight), and if the row is new, enqueue the new-device email. A failed or abandoned two-step attempt therefore never registers a device, so it can't suppress a later new-device email.

The challenge is issued only after a correct first factor, so it reveals nothing to someone guessing whether an account exists. The OpenAPI document declares both responses (200 `AuthSession`, 202 the challenge) on both first-factor endpoints, so the generated client types the union.

### `POST /auth/two-factor/verify`

Body `{ challenge, code?, recoveryCode?, trustDevice: boolean }` (exactly one of `code` or `recoveryCode`). `@Public()`, `SIGN_IN_THROTTLER`. operationId `verifyTwoFactor`.

- Look up the challenge; missing or expired → `401` "This sign-in has expired. Start again." (`type: two-factor-expired`).
- **App code:** 6 digits (spaces stripped). Accept the current 30-second step and one either side. Refuse a step ≤ `totp_last_step` (replay). On success set `totp_last_step` atomically (conditional update).
- **Recovery code:** normalised (uppercase, spaces and hyphens removed), HMAC compared; mark `used_at` with a conditional update so it works once.
- Wrong code: decrement `attemptsLeft` atomically; at 0 delete the challenge. Answer `401` "That code didn't work." (`type: two-factor-invalid`), with `attemptsLeft` in the body.
- Success: delete the challenge; create the session through `SessionService.create` (with the stored `passwordChangedAt`, so a password change during the challenge still refuses); if `trustDevice`, set `trusted_until` = now + 30 days and record `DEVICE_TRUSTED`; record `TWO_FACTOR_SUCCEEDED` or `RECOVERY_CODE_USED`; record the device and send the new-device email if due (step 4 above); return 200 `AuthSession`. Trusting a device that was not yet known creates its row with `trusted_until` set.

Recent-sign-in (`authenticated_at`) is the time of the successful verify.

### Web: the code step

A fourth step in the sign-in flow, after the password or email code:

- Heading "Two-step sign-in", text "Enter the 6-digit code from your authenticator app."
- The existing `InputOTP` (6 slots, auto-submit on the 6th digit).
- Checkbox "Don't ask again on this device for 30 days" (unticked by default; hint "Only on a device you don't share").
- Link "Use a recovery code instead" swaps to a single text field "Recovery code" (format `XXXXX-XXXXX`).
- "Start again" returns to the credentials step. When the challenge has expired, the page says so and offers "Start again".

## 7. Turning two-step on and off

All endpoints below require a signed-in session **and a recent sign-in** (within 10 minutes, `403 recent-sign-in-required` otherwise, reusing Part 2a's reauth flow).

| Method & path                        | Body                        | Success                             | Notes                                                                                    |
| ------------------------------------ | --------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /me/two-factor/setup`          | none                        | `200 { secret, otpauthUrl }`        | `409` if already on. Pending secret stored for 10 min. operationId `startTwoFactorSetup` |
| `POST /me/two-factor/enable`         | `{ code }`                  | `200 { recoveryCodes: string[10] }` | `400` wrong code; `410` setup expired. operationId `enableTwoFactor`                     |
| `POST /me/two-factor/recovery-codes` | `{ code }`                  | `200 { recoveryCodes: string[10] }` | Requires a current app code. operationId `regenerateRecoveryCodes`                       |
| `POST /me/two-factor/disable`        | `{ code? , recoveryCode? }` | `204`                               | operationId `disableTwoFactor`                                                           |

- **Secret:** 20 random bytes, base32. `otpauthUrl` = `otpauth://totp/Classloom:{email}?secret=…&issuer=Classloom&digits=6&period=30&algorithm=SHA1`. Library: `otplib` (MIT).
- **Enable:** verifies the code against the pending secret, stores the encrypted secret, sets `totp_enabled_at`, `totp_last_step`, creates 10 recovery codes, records `TWO_FACTOR_ENABLED`, sends the email. Other sessions stay signed in (they signed in before two-step existed; the user can end them from the sessions list).
- **Recovery codes:** 10 codes of 10 characters from the Crockford base32 alphabet, shown as `XXXXX-XXXXX`. Returned only in the enable and regenerate responses, never again.
- **Disable:** verifies an app code or a recovery code, clears the secret and codes, clears `trusted_until` on all the user's devices, records `TWO_FACTOR_DISABLED`, sends the email.
- Wrong codes on these endpoints count against the same per-user limit as sign-in (5 per 15 minutes, then `429`).

### Encryption

`TOTP_ENCRYPTION_KEY` (new env, 32 bytes as base64, required). AES-256-GCM with a random 12-byte IV per write; stored as `iv ‖ tag ‖ ciphertext`. The key is never logged. Rotation is out of scope (documented as a follow-up).

### CLI

`pnpm --filter @classloom/api cli users:disable-2fa <email> --reason "…"`: clears two-step and recovery codes, clears device trust, revokes all the user's sessions (`TWO_FACTOR_DISABLED`), records `TWO_FACTOR_DISABLED`, sends the "two-step turned off" email, and writes the structured CLI log line (who, what, why).

## 8. Sessions, devices and history

All are the signed-in user's **own** data across all their schools. Each response row carries the school name.

| Method & path                     | Success                                                                                     | Notes                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /me/sessions`                | `200 { sessions: [{ id, current, school, device, ip, signedInAt, lastSeenAt, remember }] }` | Live sessions only (not revoked, not expired). operationId `listMySessions`                                                                                        |
| `POST /me/sessions/{id}/revoke`   | `204`                                                                                       | `404` for an id that isn't the user's live session; the current session is refused (`400`, use sign-out). Records `SESSION_REVOKED`. operationId `revokeMySession` |
| `POST /me/sessions/revoke-others` | `204`                                                                                       | Ends every live session except the current one. operationId `revokeMyOtherSessions`                                                                                |
| `GET /me/devices`                 | `200 { devices: [{ id, label, current, firstSeenAt, lastSeenAt, trustedUntil }] }`          | operationId `listMyDevices`                                                                                                                                        |
| `POST /me/devices/{id}/untrust`   | `204`                                                                                       | Clears `trusted_until`; records `DEVICE_UNTRUSTED`. operationId `untrustMyDevice`                                                                                  |
| `GET /me/login-activity?cursor=`  | `200 { events: [{ id, type, method, school, device, ip, at }], nextCursor }`                | 20 per page, newest first, past 365 days, keyset pagination on `(created_at, id)`. operationId `listMyLoginActivity`                                               |

- `device` labels come from the user agent stored on the session or event (parsed at read time with `bowser`).
- Revoking is checked on the next request by Part 2a's middleware (no change needed).
- Ending sessions and untrusting devices do not need a recent sign-in.

### Password changes and trust

Part 2a's `SessionService.changePassword` (set, change, reset) also clears `trusted_until` on all the user's devices in the same transaction, and enqueues the "password changed" email.

## 9. Web: My account › Security

`/[locale]/account/security`, inside the app shell. The account page gets two tabs: "Profile" (`/account`) and "Security" (`/account/security`).

| Section          | Content                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Two-step sign-in | Off: explanation and "Turn on". On: "On since 2 Nov 2026", "8 recovery codes left", "New recovery codes", "Turn off" |
| Active sessions  | List (device, school, IP, signed in, last active; "This device" badge); "End" per row; "End all other sessions"      |
| Trusted devices  | List (label, last used, trusted until); "Remove" per row; empty state "No trusted devices"                           |
| Sign-in history  | Table on desktop, cards on phones; "Load more"                                                                       |

**Turn on** (a dialog with three steps):

1. "Scan this QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…)" — QR rendered client-side from `otpauthUrl` (`qrcode`, MIT), plus "Can't scan? Enter this key: XXXX XXXX…" with a copy button.
2. "Enter the 6-digit code from the app" — `InputOTP`.
3. "Save your recovery codes" — the 10 codes, "Download" (`classloom-recovery-codes.txt`), "Copy", and a checkbox "I've saved these codes" that enables "Done".

**Turn off** and **New recovery codes**: a dialog asking for an app code (Turn off also accepts a recovery code).

All copy in `messages/en.json`; dialogs are keyboard-accessible with focus returned to the trigger; 44 px touch targets.

## 10. Email

Three templates in the Part 1/2a style (plain-text part, inline-styled HTML, copy in the API's `messages/en.json`):

| Template         | Subject                                                                              | Body                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| New device       | `New sign-in to your Classloom account`                                              | School, device label, IP, time; "If this wasn't you, change your password and end the session from Security settings." with a link |
| Password changed | `Your Classloom password was changed`                                                | Time; "If this wasn't you, reset your password now" with a link to `/forgot-password`                                              |
| Two-step changed | `Two-step sign-in was turned on` / `…turned off` / `New recovery codes were created` | Time; the same "if this wasn't you" guidance                                                                                       |

Emails go through the existing `email` queue; job data holds no secret (`removeOnFail` 1 day).

## 11. Rate limits

- `POST /auth/two-factor/verify` shares `SIGN_IN_THROTTLER` (per IP, 30 per 15 minutes with password and code sign-in).
- Per challenge: 5 tries. Per user: wrong app or recovery codes (at sign-in and on the `/me/two-factor/*` endpoints) count in a Redis counter; 5 per 15 minutes, then `429` (`type: two-factor-paused`).
- `/me/sessions/*` and `/me/devices/*` mutations: 30 per hour per user.

## 12. Errors and edge cases

| Situation                                        | Behaviour                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Same app code entered twice within its window    | Second use refused (`totp_last_step`)                                                                         |
| Phone clock off by up to 30 s                    | Accepted (±1 step)                                                                                            |
| Password changed while a challenge is pending    | Verify returns `401` incorrect; no session (stored `passwordChangedAt` check)                                 |
| Two-step turned off while a challenge is pending | Verify still checks the code against the user's current state: no secret → challenge refused (`401`, expired) |
| Device cookie blocked or cleared                 | Treated as a new device: the app code is asked, and a new-device email is sent                                |
| Trusted device, but the password was changed     | Trust cleared; the app code is asked                                                                          |
| All recovery codes used                          | The page shows "0 left" with a warning to create new ones                                                     |
| Lost phone and codes                             | Support via the CLI command (section 7)                                                                       |
| Redis down during a challenge                    | `503` (as Part 2a's code flow); password-only sign-in for users without two-step still works                  |
| `TOTP_ENCRYPTION_KEY` missing                    | API refuses to start (`parseEnv`)                                                                             |

## 13. Configuration changes

- `TOTP_ENCRYPTION_KEY` (required, base64 of 32 bytes). `.env.example` gets a dev-only value with a comment; production refuses that value.
- New dependencies: `otplib` and `bowser` (API), `qrcode` (web).

## 14. Testing

| Level                                            | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (API)                                       | TOTP accepts ±1 step and refuses ±2 and replays; encryption round-trips and fails on a tampered tag; recovery-code generation format and normalisation; device-label parsing for common browsers; keyset cursor encoding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Integration                                      | Password and code sign-in return 202 with two-step on and an untrusted device; verify with an app code, a recovery code (once only), wrong codes (5 tries, then the challenge dies), an expired challenge; trusted device skips the step; a password change clears trust and refuses a pending challenge; enable/disable/regenerate need a recent sign-in and a valid code; disable clears trust; new-device email on first sight only; password-changed and two-step emails sent; sessions list shows only own live sessions, revoke and revoke-others work and the revoked session gets 401; untrust; history paging and the 365-day bound; CLI `users:disable-2fa`; isolation: another user's session or device id gives 404 |
| E2E (6 device projects + axe light/dark, 375 px) | Turn on two-step (the test computes TOTP codes from the shown key), save codes, sign out, sign in through the app-code step, trust the device, sign out and sign in without the step, change the password and see the step again, sign in with a recovery code, end another session from the list, read the history, turn two-step off                                                                                                                                                                                                                                                                                                                                                                                          |

## 15. Acceptance checklist

- [ ] Migration adds the user columns, `recovery_codes`, `known_devices` and the enum values, and runs on a Part 2a database.
- [ ] Two-step can be turned on, used at sign-in (app code and recovery code), and turned off, on every device project.
- [ ] Trusted devices skip the step for 30 days and lose trust on a password change.
- [ ] Sessions can be listed and ended; history pages back a year.
- [ ] The three email kinds are sent.
- [ ] The CLI reset works.
- [ ] No secret, raw code or token appears in logs, Redis values or job data.
- [ ] All copy is in i18n files; axe reports no WCAG 2.1 AA violations on the new screens in light and dark.
- [ ] CI is green.
