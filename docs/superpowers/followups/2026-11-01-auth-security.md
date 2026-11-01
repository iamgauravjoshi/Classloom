# Auth security (Phase 1, Part 2b): follow-ups

These items come from the per-task reviews and the final whole-branch review. None of them block merge. The final review's must-fix items were fixed on this branch: the CLI audit line and email ordering, the i18n and focus fixes on the two-step step, and the investigation of the lost "Sign out" click.

The final review found no way to skip the second factor, no secret reaching logs, Redis or job data, and no user seeing another user's data.

## For deployment

- **Rotating `TOTP_ENCRYPTION_KEY` is not supported yet.** Changing the key makes every enabled user's two-step fail with a 500 until it is reset through `users:disable-2fa`. Before any rotation, add key versioning: store a key id in the encrypted value and keep the old key for decryption only.
- **Production still accepts the dev `AUTH_SECRET`.** This is a Part 2a follow-up, now more urgent: recovery-code hashes use that key, so they could be guessed offline if the dev key were deployed.
- **The new env var `TOTP_ENCRYPTION_KEY` must exist in every environment.** It is required, and production refuses the `.env.example` value. Generate a key with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## Security hardening

- **A sign-in can leave a device trusted after two-step is turned off.** If a "trust this device" sign-in completes at the same moment as turning two-step off, the trust survives. Turning two-step back on now clears trust, which closes the cycle. Turning it off still races with an in-flight trust write.
- **Two setting changes at once can both succeed.** Running two regenerate or two disable requests in parallel lets both commit. Lock the user row (`SELECT … FOR UPDATE`) at the start of each transaction.
- **Regenerate can race disable.** This can leave unused recovery codes behind after two-step is off. It is harmless because codes are checked against the secret, and turning two-step on replaces them.
- **No alert on repeated wrong codes.** The limit of 5 wrong codes per 15 minutes still allows about 480 guesses a day, and nobody is told. Consider emailing the user when the `two-factor-paused` limit is hit.
- **Auth responses aren't marked uncacheable.** Add `Cache-Control: no-store` to `/auth/*` and `/me/two-factor/*`. POST responses aren't cached by default, so this is belt and braces.
- **A crafted history cursor gives a 500.** `decodeCursor` should validate `createdAt` with a strict ISO pattern and return 400.

## Behaviour and UX

- **Two tabs, one code.** When the same code is submitted from two tabs, the losing tab records a failure and uses up one of the user's wrong-code tries. A correct code can also be used up if a parallel wrong 5th try ends the challenge.
- **A failed trust write is silent.** The user is simply asked for the code again next time.
- **"End all other sessions" records events for expired sessions too.** It also writes those events one at a time instead of in one batch.
- **`users:disable-2fa` leaves the user's two-step Redis keys behind.** It also opens a Redis connection on every CLI command; use a lazy connection instead.
- **The new-device email doesn't use the shared `notice-layout.ts`.**
- **The API changed the order of its cookies to suit tests.** Tests should look cookies up by name instead.
- **The Security page's dialogs still show a fixed "Try again in 15 minutes"** (`account.security.errors.paused`) instead of the server's `retryAfter`. The sign-in step already uses it.
- **The end-to-end `signOut` helper in `security.spec.ts` keeps a bounded retry.** One "Sign out" click was lost once after a toast. The investigation ruled out the menu re-mounting and the toast overlapping it, and more than 500 runs without a retry never lost the click. Remove the retry if the cause is ever found.

## Tests to add

- Redis-down paths for two-step setup and enable, and for the sessions lists.
- The 365-day history boundary, and that "End all other sessions" counts toward the change limit.
- In the browser: a revoked session's page lands on sign-in. Today revocation is checked through the API.
- On phones, no sideways scrolling on the recovery-codes step or on "Load more" rows. The "Load more" test should assert the exact row count.
- Make the end-to-end tests more robust:
  - dispose request contexts in `finally`;
  - test the keyboard path from page load and check Escape returns focus;
  - make the reauth mock accept POST only;
  - split `security.spec.ts` (486 lines).
- Smaller test gaps:
  - secret-box edge cases (IV flip, empty and short input);
  - the env 33-byte key case;
  - schema tests for the challenge, setup, status and devices shapes;
  - a rollback test for clearing trust inside the password-change transaction;
  - the device cookie's `Max-Age` checked through a real `Set-Cookie` header;
  - removing the fixed sleeps (750 ms, 1.5 s).
- Housekeeping:
  - `challengeField` duplicates `randomTokenField`;
  - `sixDigitCodeField` is now exported publicly;
  - the vitest ESM/CJS warning in API test output.

## Code tidying

- **Split `two-factor.service.ts` (about 400 lines).** Move the settings methods (status, setup, enable, regenerate, disable) into a `TwoFactorSettingsService`, and the wrong-code limiter into its own service.
- **Route `enable` through a shared `withCodeLimit` helper.** Today it reserves and releases a try directly instead of going through the shared limiter.
