# Phase 1, Part 2a: Auth: sign-in and sessions

Status: draft for review · Date: 2026-10-27 · Builds on: [master design](2026-10-25-classloom-master-design.md) (section 3, "Identity & access"), [Part 1: Tenancy](2026-10-26-tenancy-design.md) · Research: [auth notes](../../research/auth.md)

## 1. Purpose

Part 1 lets a school register, but nobody can sign in yet. This part lets people with a membership sign in to their school, stay signed in safely, and recover a lost password. It also replaces the web app's mock session with the real one, so every later module knows **who** is asking and **which school** they belong to.

### Success criteria

- A newly verified school owner signs in with a code emailed to them, on a phone or a desktop, and lands on the dashboard of their school.
- The owner sets a password, signs out, and signs in again with email or mobile plus password.
- A forgotten password is reset through an emailed link.
- Signing out, suspending a school or revoking a membership cuts access on the very next request.
- No sign-in response (content or timing) reveals whether an email, mobile or account exists.
- Sign-in works on iPhone Safari with the web app and the API on different hosts.

### Decisions already made (with the user, 2026-10-27)

| Topic             | Decision                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in methods   | School code, then email or mobile. Email: one-time code or password. Mobile: password only (no SMS, see "Free-tier scope")                                                       |
| Stay signed in    | "Keep me signed in" (ticked by default): 30 days, renewed while used. Unticked: ends when the browser closes, after 2 hours idle or 12 hours                                     |
| Two-factor        | Optional for everyone; built in Part 2b                                                                                                                                          |
| Split             | **2a** (this spec): sign-in, sessions, passwords, real session in the web app. **2b**: security settings page (sessions list, login history, 2FA, security emails)               |
| Google sign-in    | Not now                                                                                                                                                                          |
| Session mechanism | Database sessions behind a first-party cookie, with the web app passing API calls through (section 5). Replaces the master design's "JWT access token + rotating refresh cookie" |

## 2. Scope

**In scope**

- Sign-in by email code (OTP) or password, with the school code.
- Sessions: creation, validation on every request, expiry, sign-out.
- Same-site API access: the web app proxies `/api/*` to the API.
- Passwords: policy, hashing, first-time set, change, forgot and reset by email.
- Abuse protection: account pauses after failed passwords, per-IP rate limits, no account enumeration.
- A sign-in event log (`auth_events`), written from day one, shown in Part 2b.
- Minimal "My account" page: name, mobile, password.
- The web app's route protection and the real session in the app shell.

**Out of scope**

- **Part 2b:** sessions list and "sign out everywhere", login history page, authenticator-app 2FA and recovery codes, security notification emails (new device, password changed, account paused).
- **Part 3 (IAM):** roles beyond `OWNER`, inviting staff, permissions, platform admin screens, school-level security policy (e.g. "require 2FA for admins").
- **Later:** Google or other social sign-in, passkeys, SMS codes, lock screen, switching between schools without signing in again, Redis caching of sessions.

## 3. Concepts

| Term                   | Meaning                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier**         | What a person types to say who they are: an email or an Indian mobile number. Parsed with `parseIdentifier` from `@classloom/utils`.     |
| **Sign-in code (OTP)** | A 6-digit one-time code emailed to the account's address. Valid 10 minutes.                                                              |
| **Session**            | One signed-in browser. Bound to one user **and one school** (membership). A random token in a cookie; the database stores only its hash. |
| **Remembered session** | "Keep me signed in" ticked: a persistent cookie and a 30-day sliding expiry.                                                             |
| **Pause**              | After 5 wrong passwords, password sign-in for that identifier at that school stops for 15 minutes. Email-code sign-in keeps working.     |
| **Recent sign-in**     | A session whose sign-in happened in the last 10 minutes. Required before setting a first password.                                       |

## 4. Data model

Prisma schema file: `apps/api/prisma/schema/auth.prisma` (new) plus changes to `tenancy.prisma`. All new tables use UUIDv7 keys and `timestamptz`.

### User (`users`): new columns

| Column                | Type         | Rules                                                                                      |
| --------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `password_hash`       | text?        | argon2id encoded string; null until the user sets a password                               |
| `password_changed_at` | timestamptz? | Set whenever the password is set, changed or reset                                         |
| `mobile`              | text?        | **Now unique** (partial unique index where not null), so mobile sign-in is never ambiguous |

**Migration:** before adding the unique index, duplicate mobiles are cleared on every user except the oldest one holding that number. There is no production data yet; this only protects local databases.

### Session (`sessions`): platform-level, not row-level secured

Looked up before any tenant context exists, like `registration_tokens`, so it is exempt from `TENANT_SCOPED_MODELS` via `PLATFORM_MODELS_WITH_TENANT_FK`.

| Column             | Type         | Rules                                                                                                           |
| ------------------ | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `id`               | uuid         | PK                                                                                                              |
| `token_hash`       | bytea        | Unique; SHA-256 of a 32-byte random token; the raw token exists only in the cookie                              |
| `user_id`          | uuid         | FK → users, cascade                                                                                             |
| `tenant_id`        | uuid         | FK → tenants, cascade                                                                                           |
| `membership_id`    | uuid         | FK → memberships, cascade                                                                                       |
| `remember`         | boolean      | "Keep me signed in"                                                                                             |
| `authenticated_at` | timestamptz  | When the person proved who they are (sign-in time); used for "recent sign-in"                                   |
| `last_seen_at`     | timestamptz  | Updated at most once every 5 minutes                                                                            |
| `idle_expires_at`  | timestamptz? | Not remembered only: `last_seen_at` + 2 hours                                                                   |
| `expires_at`       | timestamptz  | Remembered: `last_seen_at` + 30 days (sliding), capped at sign-in + 90 days. Not remembered: sign-in + 12 hours |
| `ip`               | inet?        | Client address at sign-in                                                                                       |
| `user_agent`       | text?        | Truncated to 512 characters                                                                                     |
| `revoked_at`       | timestamptz? | Set on sign-out or revocation                                                                                   |
| `revoked_reason`   | enum?        | `SIGNED_OUT`, `PASSWORD_CHANGED`, `PASSWORD_RESET`, `REPLACED`                                                  |

Indexes: `user_id`, `tenant_id`, `expires_at`.

### Auth event (`auth_events`): platform-level, not row-level secured

| Column       | Type  | Rules                                                                                                                                                                     |
| ------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | uuid  | PK                                                                                                                                                                        |
| `type`       | enum  | `SIGN_IN_SUCCEEDED`, `SIGN_IN_FAILED`, `SIGN_IN_PAUSED`, `CODE_REQUESTED`, `PASSWORD_SET`, `PASSWORD_CHANGED`, `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET`, `SIGNED_OUT` |
| `method`     | enum? | `PASSWORD`, `EMAIL_CODE`, `RESET_LINK`                                                                                                                                    |
| `user_id`    | uuid? | FK → users, `SET NULL`; null when the identifier matched nobody                                                                                                           |
| `tenant_id`  | uuid? | FK → tenants, `SET NULL`                                                                                                                                                  |
| `session_id` | uuid? | FK → sessions, `SET NULL`                                                                                                                                                 |
| `ip`         | inet? |                                                                                                                                                                           |
| `user_agent` | text? | Truncated to 512 characters                                                                                                                                               |

The typed identifier is **never** stored, so the log holds no email or mobile of people who are not users. Index: `(user_id, created_at desc)`.

### Short-lived state in Redis

| Key                                      | Value                                | TTL    |
| ---------------------------------------- | ------------------------------------ | ------ |
| `auth:otp:{tenantId}:{userId}`           | HMAC of the code, attempts left (5)  | 10 min |
| `auth:otp-sent:{tenantId}:{userId}`      | Send count this hour; last send time | 1 hour |
| `auth:fail:{tenantId}:{identifierHash}`  | Failed password count                | 15 min |
| `auth:pause:{tenantId}:{identifierHash}` | Present while paused                 | 15 min |
| `auth:reset:{tokenHash}`                 | User ID                              | 30 min |
| `auth:reset-user:{userId}`               | The user's current reset token hash  | 30 min |

- `identifierHash` is an HMAC of the normalised identifier, so Redis holds no raw emails or mobiles.
- Codes are compared as HMACs with `AUTH_SECRET`, because a plain SHA-256 of 6 digits can be reversed instantly.
- Losing Redis loses only codes, links and pause counters in flight; people request new ones.

### Clean-up

A daily BullMQ job (same scheduler pattern as Part 1's purge):

- Deletes sessions that expired or were revoked more than 7 days ago.
- Deletes `auth_events` older than 1 year.

Both tables are platform-level, so the app role deletes directly; no `SECURITY DEFINER` function is needed.

## 5. Sessions and the same-site proxy

### Why a proxy

The web app (Vercel) and the API (another free host) are different sites. A cookie set by the API would be a third-party cookie, which Safari and every iPhone browser block. So the browser only ever talks to the web app:

- `next.config.ts` rewrites `/api/:path*` to `${API_INTERNAL_URL}/:path*`. Responses, including `Set-Cookie`, pass through unchanged.
- In the browser, the Orval fetcher uses the same-origin base `/api` with `credentials: 'same-origin'`.
- On the server (React Server Components, route handlers), the fetcher calls `API_INTERNAL_URL` directly and forwards the incoming `cookie` header.
- `NEXT_PUBLIC_API_URL` is removed.
- The API keeps its CORS allow-list (`WEB_ORIGIN`) for local tools, but the web app no longer depends on it.

### Cookie

| Attribute | Value                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Name      | `__Host-cl_session` when `COOKIE_SECURE=true` (deployed); `cl_session` otherwise (local and CI, plain HTTP)                              |
| Value     | 32 random bytes, base64url                                                                                                               |
| Flags     | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when `COOKIE_SECURE=true`, no `Domain`                                                    |
| Lifetime  | Remembered: `Max-Age` 30 days, re-sent when the expiry slides (at most once a day). Not remembered: no `Max-Age` (ends with the browser) |

`COOKIE_SECURE` defaults to `true` when `NODE_ENV=production` and `false` otherwise. WebKit refuses `Secure` cookies on `http://localhost`, which is why local runs drop the prefix and flag.

### Validation on every request

A Nest middleware (`SessionMiddleware`) runs before guards:

1. Reads the cookie. No cookie → anonymous.
2. Looks up the session by `token_hash`, joined to its tenant. The session is valid only if it is not revoked, `expires_at` and `idle_expires_at` (if set) are in the future, and the tenant is `ACTIVE`.
3. Enters `TenantContext.run(session.tenantId, …)` and, before handing over to the route, checks within that context that the membership is still `ACTIVE`. The rest of the request runs inside that context. An invalid session is treated as anonymous, and the response clears the cookie.
4. Attaches `request.auth = { sessionId, userId, tenantId, membershipId, role }`.
5. Touches `last_seen_at` (and slides the expiries) if more than 5 minutes have passed.

A global `AuthGuard` then refuses (`401`) any route without `request.auth` unless the route or controller is marked `@Public()`. Existing public routes are marked: health, OpenAPI docs, school code availability, public school lookup, and all `school-registrations` endpoints.

A suspended school, a revoked membership or a revoked session is therefore refused on the next request, with no waiting period.

### Session fixation and rotation

- Every successful sign-in creates a new session. If the request carried a valid session cookie, that session is revoked with `REPLACED`.
- Setting or changing a password revokes **all other** sessions of the user (`PASSWORD_CHANGED`). The current one stays.
- A password reset revokes **all** sessions of the user (`PASSWORD_RESET`).

### Cross-site request protection

- `SameSite=Lax` keeps the cookie off cross-site `POST`s.
- As a second layer, an `OriginCheckMiddleware` refuses (`403`) any `POST`, `PUT`, `PATCH` or `DELETE` that carries the session cookie unless its `Origin` header equals `WEB_ORIGIN`. Browsers send `Origin` on these requests, and the proxy forwards it unchanged.

### Client address behind proxies

The API sets Express `trust proxy` from `TRUST_PROXY` (default `loopback`), so `request.ip` is the browser's address when the call comes through the web app. Rate limits and `auth_events.ip` use it. The deployed value depends on the chosen hosts and is set at deployment (already a tenancy follow-up).

## 6. Sign-in flow

### Web: `/[locale]/sign-in` (public, `(auth)` route group, outside the app shell)

Follows the Figma sign-in and 2-step frames: a centred card (max 440 px) on the light canvas with the soft primary glow, the Classloom logo above and the copyright below. Full-width on phones.

**Step 1: school**

- One field, "School code", with the hint "Your school's short code, for example GISD".
- On "Continue" the page calls `GET /schools/:code/public`. Unknown, pending, suspended or closed codes show "We couldn't find a school with that code."
- The code is pre-filled from `?school=GISD` in the URL, else from `localStorage` (`classloom.schoolCode`, saved after each successful sign-in). With a known code the page opens straight on step 2.

**Step 2: who you are**

- A header line: "Signing in to **Global International School**, Dehradun · Change". "Change" returns to step 1.
- Fields:
  - "Email or mobile number" (`autocomplete="username"`).
  - "Password" with a show/hide button (`autocomplete="current-password"`), and a "Forgot password?" link.
  - "Keep me signed in" checkbox, ticked by default, with the hint "Untick on a shared computer".
- Buttons:
  - **Sign in** (primary): password sign-in.
  - **Email me a sign-in code** (secondary): enabled only when the identifier parses as an email. For a mobile, a hint explains "Sign-in codes are sent by email. Use your password, or enter your email."
- Errors:
  - Wrong credentials of any kind: "Email/mobile or password is incorrect."
  - Paused: "Too many attempts. Try again in 15 minutes, or sign in with an email code."
  - Rate limited by IP: "Too many attempts from this network. Try again later."

**Step 3: code** (after "Email me a sign-in code")

- "Check your email. If **a…@example.com** has an account at this school, we've sent a 6-digit code."
- A 6-slot code input (shadcn `InputOTP`: one real input with `inputmode="numeric"` and `autocomplete="one-time-code"`, so paste and SMS-style autofill work), auto-submitting on the 6th digit, plus a **Verify** button.
- "Code expires in 09:42". The countdown is hidden from screen readers; an `aria-live="polite"` message announces only "The code has expired".
- "Resend code", disabled for 60 seconds after each send. "Use password instead" returns to step 2.
- Wrong or expired code: "That code is incorrect or has expired." After 5 wrong tries the code stops working, with the same message plus "Request a new code".

**After sign-in**

- The school code is saved to `localStorage`.
- The browser goes to `?next=` if it is a safe path, else `/[locale]/dashboard`. A safe path starts with a single `/`, has no `\`, and starts with a supported locale.

### API

| Method & path                 | Body                                             | Success                                               | Errors                                                                                                         |
| ----------------------------- | ------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `POST /auth/sign-in/password` | `{ schoolCode, identifier, password, remember }` | `200 { session }` + `Set-Cookie`                      | `400` validation; `401` invalid credentials; `429` paused (`type: sign-in-paused`, `retryAfter`) or IP-limited |
| `POST /auth/otp/request`      | `{ schoolCode, email }`                          | `202 { maskedEmail }` always                          | `400` not an email; `429` IP-limited                                                                           |
| `POST /auth/otp/verify`       | `{ schoolCode, email, code, remember }`          | `200 { session }` + `Set-Cookie`                      | `400` validation; `401` incorrect or expired (one response for all failure reasons); `429`                     |
| `POST /auth/sign-out`         | none                                             | `204` + cookie cleared (also when already signed out) | none                                                                                                           |
| `GET /auth/session`           | none                                             | `200 { session }`                                     | `401`                                                                                                          |

`session` is:

```json
{
  "user": {
    "id": "…",
    "name": "Anita Sharma",
    "email": "anita@example.com",
    "mobile": "+919876543210",
    "hasPassword": true
  },
  "school": { "id": "…", "code": "GISD", "name": "Global International School" },
  "campus": { "id": "…", "name": "Global International School" },
  "role": "OWNER",
  "remember": true,
  "expiresAt": "2026-11-26T08:42:00.000Z"
}
```

`campus` is the school's primary campus until a campus switcher arrives (Part 4).

### Password sign-in rules

1. Resolve the school by code. It must be `ACTIVE`.
2. If the identifier is paused for that school, return `429` (a pause applies to unknown identifiers too, so it reveals nothing).
3. Find the user by email or mobile, then the membership in that school (inside the tenant context). It must be `ACTIVE`, and the user must have a password.
4. Verify the password with argon2id. When any earlier step failed, verify against a fixed dummy hash instead, so every failure takes the same time.
5. On failure: increment the failure counter; at 5, set the pause, write `SIGN_IN_PAUSED`, and return `429`; otherwise write `SIGN_IN_FAILED` and return `401`. An unknown school is a plain `401`.
6. On success: clear the failure counter, create the session, write `SIGN_IN_SUCCEEDED` (`PASSWORD`), and return the session.

### Email code rules

- **Request.** The controller validates input, enqueues an `auth.send-code` job with `{ schoolCode, email }` and returns `202` at once, so the response time never depends on whether the account exists.
- **The job** does nothing unless the school is `ACTIVE`, the user exists and the membership is `ACTIVE`. It also drops the send if the last one was under 60 seconds ago or 5 were sent this hour (per user and school). Otherwise it generates the code with a CSPRNG, stores its HMAC (replacing any earlier code), enqueues the email, and writes `CODE_REQUESTED`.
- **The raw code** exists only in the job's memory and in the email; job data never contains it.
- **Verify** checks the HMAC in constant time. Each wrong try uses one of 5 attempts; at 0 the code is deleted. Success deletes the code (single use), sets `users.email_verified_at` if empty (the code proves the address), creates the session, and writes `SIGN_IN_SUCCEEDED` (`EMAIL_CODE`). A successful code sign-in does **not** clear a password pause.

This settles the open tenancy question: schools activated through the CLI have an unverified owner email, and the first code sign-in verifies it.

## 7. Passwords

### Policy

Shared Zod schema in `@classloom/contracts`; the server adds the checks that need data:

- 10 to 128 characters; any characters, spaces included. No forced mix of character classes, and no expiry, following NIST SP 800-63B.
- Not in a bundled list of the 10,000 most common passwords (from SecLists, MIT licence), compared case-insensitively. Server only.
- Must not contain the user's email local part (when 4 or more characters), or the school code.

The web form shows the rules as a checklist that ticks as you type, without a strength meter.

### Hashing

- argon2id with the OWASP baseline: memory 19 MiB, 2 iterations, parallelism 1. Parameters live in the encoded hash, so they can be raised later; a successful sign-in re-hashes a password whose parameters are out of date.

### Forgot and reset

**Web: `/[locale]/forgot-password`**

- One field, "Email or mobile number", and "Send reset link".
- The answer is always: "If an account matches, we've emailed a reset link to its address. It expires in 30 minutes." Mobile users get the link at their account email; every user has one.

**API:**

| Method & path                | Body                     | Success | Errors                                                                          |
| ---------------------------- | ------------------------ | ------- | ------------------------------------------------------------------------------- |
| `POST /auth/password/forgot` | `{ identifier }`         | `202`   | `400`, `429` IP-limited                                                         |
| `POST /auth/password/reset`  | `{ token, newPassword }` | `204`   | `400` policy errors (`errors[]`); `410` expired, used or unknown (one response) |

- **Forgot** enqueues an `auth.send-reset` job and returns `202` at once.
- **The job** finds the user by email or mobile. It sends only when the user has at least one `ACTIVE` membership in an `ACTIVE` school, and at most 3 links per user per hour. It creates a 32-byte token, stores its SHA-256 in Redis (replacing the user's previous token, so only the newest link works), emails the link `${WEB_ORIGIN}/en/reset-password?token=…`, and writes `PASSWORD_RESET_REQUESTED`.
- **Reset**:
  - Takes the token with an atomic `GETDEL`, so it is single use.
  - Applies the policy (the school-code check uses every school the user belongs to) and sets the hash and `password_changed_at`.
  - Sets `email_verified_at` if empty, revokes **all** the user's sessions, and writes `PASSWORD_RESET`.
  - It does not sign the user in.

**Web: `/[locale]/reset-password?token=…`**

- The page removes the token from the address bar on load (`history.replaceState`) and keeps it in memory.
- It shows "New password" and "Confirm password" with the rules checklist.
- The token is spent only when the form is submitted, so mail scanners that pre-open links can't use it up.
- Success: "Your password has been changed. Sign in with your new password", with a button to `/sign-in`.
- `410`: "This link has expired or was already used", with a link to `/forgot-password`.

### Set and change while signed in

`PUT /me/password` with `{ currentPassword?, newPassword }`:

| Situation                        | Rule                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User has a password              | `currentPassword` required; wrong → `400` with `errors: [{ path: 'currentPassword' }]`, and it counts towards the pause                                                                                       |
| User has no password (first set) | Requires a recent sign-in (within 10 minutes). Otherwise `403` with `type: recent-sign-in-required`, and the web page sends the person through the email-code flow again (pre-filled), then back to this form |

Both revoke the user's other sessions and write `PASSWORD_SET` or `PASSWORD_CHANGED`.

## 8. My account

**Web: `/[locale]/account`** (inside the app shell, reached from the user menu's "My account").

| Section  | Content                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile  | Name (2–80), email (read-only, with "Verified" when `email_verified_at` is set), mobile (optional, Indian numbers via `normalizeIndianMobile`) |
| Password | "Set a password" (when none: "You sign in with email codes. Add a password to also sign in with your mobile number") or "Change password"      |

**API:**

| Method & path      | Body                                            | Success        | Errors                                                                              |
| ------------------ | ----------------------------------------------- | -------------- | ----------------------------------------------------------------------------------- |
| `GET /me`          | none                                            | `200 { user }` | `401`                                                                               |
| `PATCH /me`        | `{ name?, mobile? }` (`null` clears the mobile) | `200 { user }` | `400`; `409` mobile used by another account (`errors: [{ path: 'mobile' }]`); `429` |
| `PUT /me/password` | section 7                                       | `204`          | section 7                                                                           |

`PATCH /me` is limited to 20 changes per hour per user, which slows anyone using the `409` to probe whose number is registered.

**Registration change:** `POST /school-registrations` no longer saves a mobile that already belongs to another user. The school is still created, and the owner can add a mobile on this page. A public `409` would let anyone test whether a number is registered.

## 9. Web app changes

- **Route groups:**
  - `(auth)`: `sign-in`, `forgot-password` and `reset-password`, sharing the auth card layout.
  - `(app)`: gains `account`.
- **`src/proxy.ts`:** requests to `(app)` paths without a session cookie are redirected to `/[locale]/sign-in?next=<path>`. This is a fast first check only; the `(app)` layout does the real validation.
- **`(app)/layout.tsx`:** fetches `GET /auth/session` on the server. On `401` it redirects to sign-in with `next`.
- **`(auth)` pages:** when a valid session exists, they redirect to the dashboard.
- **`lib/mock-session.ts` is removed.**
  - `lib/session.ts` maps the API session to the shell's `Session` type.
  - `OWNER` maps to the `admin` role, with every nav permission until Part 3 adds real permissions.
  - The shell shows the user's name and the school's primary campus.
- **User menu:** "My account" and "Sign out". Sign-out calls `POST /auth/sign-out`, clears the TanStack Query cache, and goes to `/sign-in`.
- **Expired sessions:** a `401` from any client-side query also redirects to sign-in with `next` set to the current page.
- **Registration verify page:** the success state's "sign-in arrives soon" note becomes a **Sign in** button to `/[locale]/sign-in?school=GISD`. The "already used" copy changes the same way.
- **New UI components** (in `packages/ui`, with Storybook stories for every state):
  - `InputOTP` (shadcn).
  - `PasswordInput` (show/hide toggle, 44 px touch target).
  - `PasswordRules` (live checklist).
  - `AuthCard` (the Figma card layout).
- **i18n:** all copy lives in `messages/en.json`.

## 10. Email

Two new templates, built the same way as Part 1's (table-based HTML, inline styles, brand primary, plain-text part, copy in the API's `messages/en.json`):

| Template       | Subject                                 | Body                                                                                                                                          |
| -------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in code   | `482913 is your Classloom sign-in code` | School name, the code in large type, "Expires in 10 minutes", "If you didn't try to sign in, you can ignore this email; your account is safe" |
| Password reset | `Reset your Classloom password`         | Reset button and link, "Expires in 30 minutes", "If you didn't ask for this, ignore this email; your password hasn't changed"                 |

Both go through the existing `email` queue with its retries.

## 11. Rate limits

Per client IP, with Redis storage, using the named-throttler pattern from Part 1. Values come from env vars so tests can change them.

| Route(s)                                              | Default           | Env var                              |
| ----------------------------------------------------- | ----------------- | ------------------------------------ |
| `/auth/sign-in/password`, `/auth/otp/verify` (shared) | 30 per 15 minutes | `SIGN_IN_RATE_LIMIT_PER_15_MIN`      |
| `/auth/otp/request`                                   | 10 per hour       | `CODE_REQUEST_RATE_LIMIT_PER_HOUR`   |
| `/auth/password/forgot`                               | 10 per hour       | `PASSWORD_RESET_RATE_LIMIT_PER_HOUR` |

Per-account limits are fixed in code:

- Password sign-in: 5 failures per identifier and school, then a 15-minute pause.
- Codes: 5 tries per code; 1 send per 60 seconds and 5 sends per hour per user and school.
- Reset links: 3 per hour per user.
- `PATCH /me`: 20 per hour per user.

## 12. Errors and edge cases

| Situation                                                      | Behaviour                                                                                                                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner of a new school has no password and tries a password     | `401` "incorrect", same as any failure; the screen also offers the email code                                                                                                                           |
| Mobile entered and "Email me a sign-in code" pressed           | Button is disabled; the API returns `400` if called directly                                                                                                                                            |
| Same person belongs to two schools                             | Each school code gives a separate session; one password works for both (users are global)                                                                                                               |
| School suspended while people are signed in                    | Next request: `401`, cookie cleared, redirect to sign-in; the code step then says the school can't be found                                                                                             |
| School reactivated after a suspension                          | Sessions are not revoked by a suspension, only refused while it lasts, so unexpired sessions work again                                                                                                 |
| Membership revoked                                             | Next request: `401`; sign-in to that school fails as "incorrect"                                                                                                                                        |
| Two tabs open, one signs out                                   | The other tab's next request gets `401` and redirects to sign-in                                                                                                                                        |
| Code requested twice quickly                                   | The second send is dropped silently (60-second rule); the first code still works                                                                                                                        |
| A new code is sent                                             | The previous code stops working                                                                                                                                                                         |
| Reset link opened by a mail scanner                            | Nothing is spent; the token is used only by the form's `POST`                                                                                                                                           |
| Reset link used twice                                          | Second time `410`                                                                                                                                                                                       |
| Redis down                                                     | Code and reset requests fail fast (`503` problem+json, as Part 1's queue); password sign-in still works, but the pause counter fails open and the IP limits fail open as in Part 1; a warning is logged |
| `?next=//evil.example` or an absolute URL                      | Ignored; dashboard instead                                                                                                                                                                              |
| Cookie sent on a cross-site `POST` (shouldn't happen with Lax) | `403` from the origin check                                                                                                                                                                             |

All API errors keep the RFC 7807 format (`application/problem+json`).

## 13. Configuration changes

API (validated by `parseEnv`, documented in `.env.example`):

- `AUTH_SECRET`: at least 32 characters; HMAC key for codes and identifier hashes. Required.
- `COOKIE_SECURE`: boolean; defaults to `true` in production and `false` otherwise.
- `TRUST_PROXY`: Express `trust proxy` value; default `loopback`.
- `SIGN_IN_RATE_LIMIT_PER_15_MIN` (30), `CODE_REQUEST_RATE_LIMIT_PER_HOUR` (10), `PASSWORD_RESET_RATE_LIMIT_PER_HOUR` (10).

Web:

- `API_INTERNAL_URL`: where the server and the `/api` rewrite reach the API (default `http://localhost:4000`).
- `NEXT_PUBLIC_API_URL` is removed.

New dependencies: `argon2` (API) and `input-otp` (via the shadcn `InputOTP` component).

## 14. Testing

| Level                                                   | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (`@classloom/contracts`, `@classloom/utils`)       | Password schema limits; safe `next` path check (`/en/x` ok; `//x`, `/\x`, `https://x` and unknown locales rejected)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Unit (API)                                              | Session expiry maths (remembered sliding with the 90-day cap; not remembered, idle and absolute); password policy (common list, email local part, school code); masked email; identifier HMAC normalisation (case, spaces, `+91` formats)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Integration (Testcontainers Postgres + Redis + Mailpit) | **Password sign-in:** success sets the cookie with the right flags and creates a session; wrong password, unknown user, no password, revoked membership, other school and unknown code all give the identical `401` body; failures for unknown and known accounts take comparable time (dummy hash, no early return); 5 failures pause, the 6th gets `429` even with the right password, and the email code still works. **Codes:** the email lands in Mailpit; verify signs in and sets `email_verified_at`; a wrong code uses an attempt and the 6th try fails even with the right code; a new code kills the old one; requests for unknown accounts return the same `202` and send nothing; the 60-second rule. **Sessions:** expiry and idle expiry refuse; sliding renewal; sign-out revokes; suspending the school (via the CLI service) and revoking the membership cut access on the next request; a protected route without a cookie gives `401`; the tenant context comes from the session (a scoped query returns only that school's campuses); a cross-site `Origin` is refused. **Passwords:** forgot sends a link only for real active users; reset is single use, revokes all sessions and does not sign in; the second reset link supersedes the first; first set needs a recent sign-in; change revokes other sessions only. **Mobile:** sign-in by mobile and password; `409` on a taken mobile in `PATCH /me`; registration silently skips a taken mobile. **Clean-up:** the job deletes old sessions and events only |
| E2E (6 device projects + axe, light and dark)           | Register a school, verify it, press "Sign in", sign in with the emailed code (read through Mailpit's API), set a password on My account, sign out, sign in with mobile and password, use "Forgot password" and reset, sign in with the new password. Also: a protected page redirects to sign-in and back after signing in; wrong password error; the code step keyboard-only on desktop; no horizontal overflow at 375 px on every new page; axe on sign-in (all three steps), forgot, reset and account                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Existing E2E tests** for the dashboard and students pages now need a signed-in user. A Playwright setup project signs in once through the real code flow (a school created by the registration API plus Mailpit) and saves the browser state, which the other projects reuse. There is no test-only API endpoint.

## 15. Acceptance checklist

- [ ] Migrations add the user columns, the unique mobile index, `sessions` and `auth_events`, and run clean on an empty database and on a Part 1 database.
- [ ] A verified owner signs in with an email code and with a password, on every device project, with the web app reaching the API only through `/api`.
- [ ] Forgot and reset password work end to end.
- [ ] Signing out, suspending a school and revoking a membership cut access on the next request.
- [ ] Enumeration tests pass: identical bodies, and comparable timing for password failures.
- [ ] The mock session is gone; the app shell shows the signed-in user and school.
- [ ] All copy is in i18n files; axe reports no WCAG 2.1 AA violations on the new pages in light and dark.
- [ ] CI (lint, typecheck, unit, build, integration, E2E) is green.
