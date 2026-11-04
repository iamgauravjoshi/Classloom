# School onboarding (Phase 1, Part 4): follow-ups

These items come from the per-task reviews and the final whole-branch review. None of them block merge.

The build decisions are recorded in the spec's §15.

## For your local setup

- `pnpm db:migrate` applies `20261103100000_school_onboarding`. Your local dev database is already migrated: every school got a profile row and no academic years.
- After this deploys, every existing owner sees the setup wizard once, on their next visit to the dashboard.
- `school:demo-setup <code>` fills a school with demo data (see the README's Platform CLI section). It needs storage running (`pnpm infra:up`).
- pnpm's own binary still fails on this machine (a missing Windows C runtime DLL). `npx -y pnpm@12.6.0 …` works in the meantime. To fix it, reinstall pnpm or install the Microsoft Visual C++ Redistributable.

## Behaviour to tidy

- **Toast over the wizard's Continue button on desktop.** A toast can still cover it, and hovering pauses its timer. Mobile is fixed.
- **`?step=` links once the wizard has moved on.** A link to the step the wizard first opened on is ignored after the person has moved to another step. Fix by syncing `shownInitialStep` in `show()`.
- **Browser Back.** The wizard's leave guard can't catch the browser's Back button.
- **Year switcher with no current year.** It reads "AY not set" when years exist but none is current. That can't happen once a school has a year, but a fallback to the newest year would read better.
- **Lost focus.** After some Settings actions focus is lost, and the "replace your terms?" prompt reappears as you type.
- **Automatic label.** There's no way to go back to the automatic year label after editing it.
- **Leftover alert.** The profile form's "check the highlighted fields" alert stays visible after the fields are fixed.
- **Sidebar retries.** The sidebar's profile query retries 3 times when the API is down.

## Hardening

- **S3 timeout.** The client's `requestTimeout` limits an idle socket, not the whole request. A put that trickles data slowly isn't capped at about 15 s, so consider an overall abort signal.
- **Startup when storage hangs.** Bucket creation at startup has no abort signal, so a hanging storage host slows boot by up to about 20 s.
- **Migration guard order.** The guard runs after the `lower(name)` index. Duplicate campus names that differ only in case would fail with a bare 23505 instead of a clear message.
- **Tenant status.** `school:demo-setup` ignores tenant status, and has no test for storage being down or for a partly filled school.
- **Small API items:**
  - the problem `reason` could be an enum;
  - `If-None-Match` is compared exactly;
  - the logo 404 has no problem type.

## Tests to add

- **Academic years:** cross-school 404 and Teacher 403 tests for make-current, DELETE and PATCH; a forced-interleaving race test (the current one relies on HTTP scheduling); make-primary racing deactivate.
- **Schema:** zod tests for update and partial semantics, the year-length boundary, the established year and the https website.
- **Image metadata:** also assert no ICC, XMP or text chunks remain.
- **Rate limit:** the fail-open path when Redis is down.
- **Profile form:** the server-400 field-error path.
- **Flaky:** `email.int.test.ts` sometimes times out on Mailpit, and parallel Firefox and WebKit runs can time out under load.
- **Prettier:** `apps/api/test/auth/password-sign-in.int.test.ts` fails a prettier check (older file).

## Code tidying

- `ConfirmDialog` lives in `years-list.tsx`; move it to a shared module.
- `CampusesService` is exported but nothing outside the module uses it yet.
- The web E2E logo fixture is read from the API's test fixtures folder.
