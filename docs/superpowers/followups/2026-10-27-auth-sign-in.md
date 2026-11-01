# Auth sign-in (Phase 1, Part 2a): follow-ups

Collected from the per-task reviews and the final whole-branch review. None of these block merge. The final review's must-fix items were fixed on the branch.

## For deployment

- Set `TRUST_PROXY` to the real proxy hop count once hosting is chosen. Until then, every browser shares the web host's egress IP for per-IP limits. Behind a self-hosted `next start`, a client-supplied `X-Forwarded-For` passes through the `/api` rewrite unchanged. Re-check `auth_events.ip` after the first deploy. See also the tenancy follow-ups.
- `API_INTERNAL_URL` is fixed when the web app is built. Set it in the Vercel build environment.
- Vercel preview deployments have their own origin, so the Origin check refuses their cookie-bearing POSTs. Document this, or allow-list preview origins.
- Refuse the `.env.example` dev `AUTH_SECRET` and the default `WEB_ORIGIN` when `NODE_ENV=production`.
- Local `.env` files still list `NEXT_PUBLIC_API_URL`. Replace it with `API_INTERNAL_URL` (copy from `.env.example`).

## Security hardening

- Make the code CONSUME compare-and-delete, so an old code can't consume a just-written new one (millisecond window).
- Add a daily cap on code sends per user (5 per hour still allows about 600 code guesses a day).
- Move the reset token into the URL fragment (`#token=`) so it never reaches web-host request logs. This needs a spec change.
- Sign-out should revoke the session row even when the membership is revoked or the school suspended. Otherwise a copied cookie revives when the school is reactivated.
- Make the origin check an allow-list of safe methods (GET/HEAD/OPTIONS) instead of a list of unsafe ones.
- `user_schools()` returns every membership for any user id; its comment overstates the guarantee. Narrow it or fix the comment.
- A job retry after a failed enqueue can issue a second reset token, or leave the user with no working link.
- Make `passwordChangedAt` required in `SessionService.create`. It is optional today, so a future caller that omits it skips the stale-password check.
- The shared sign-in throttle key stores raw client IPs in Redis key names for 15 minutes. Hash it the way the library default does.
- A sign-in refused because the password just changed has already cleared the fail counter, or consumed the code, and records no failure event. Add tests for the email-code path and for the "sign-in commits first" order.
- `classloom.sentCode` is cleared on an explicit sign-out but not when a 401 redirect ends the session.

## Reliability and UX

- WebKit loses text typed into the reset form before hydration. Disable the inputs until hydrated, or read uncontrolled inputs on submit.
- The shared toast overlaps form buttons on phones.
- After reauth, show a hint to retype the new password.
- "Request a new code" is plain text; make it an action.
- Resend resets the wrong-tries count even when the server dropped the send.
- A 401 on sign-out triggers both the global redirect and the user menu's navigation (a double navigation).
- Future `(app)` pages that render server data must call `requireServerSession()` themselves. Server-side `apiFetch` doesn't forward cookies.
- `proxy.ts` rebuilds the `NextRequest` without method or body. Fix this before any Server Action is added.
- Load the common-password list eagerly at startup. Add a `.catch` to the dummy-hash promise, and guard `needsRehash` against malformed hashes.
- The `safeNextPath` doc comment should say it trusts `fallback`. Treat percent-encoded `sign-in` paths as the sign-in page. `passwordSchema` counts UTF-16 units, not code points.
- Add an index on `sessions.membership_id`. Today the FK cascade scans the table.
- Apply the nullable OpenAPI wrapper to every new DTO with a top-level nullable field.

## Tests to add

- `parseTrustProxy` branches, and that an untrusted peer's `X-Forwarded-For` is ignored.
- Origin check on PUT/PATCH/DELETE; the cookie cleared for a suspended school; the `COOKIE_SECURE=true` clearing header; the cookie-refresh re-set through the pipeline.
- Membership-delete cascade of sessions; registration keeping the registering email's own mobile.
- A reset revoking the session that was current when it ran; the `reauthPhase` error mapping; the `useRememberedSchool` storage-event path.
- IP-throttle tests for the code routes; raise the timing test's sample count if it ever flakes.
- Clean up the test code. In the session-expiry and sessions tests, use clearer names, assert the derived `lastSeenAt`, and isolate the not-remembered refresh test. In `account.spec`, have the `emailedCode` helper skip already-seen messages. Remove the Prettier reflow in `shell.spec.ts`.

## Code tidying

- Share one HTML-escaping helper across the three email templates.
- Remove the private `findUser` in `PasswordSignInService` in favour of `member-lookup`.
- `GET /auth/session` resolves the session twice; type `CurrentAuth` as optional on public routes.
- UI polish: the `PasswordShown` story relies on `play()`; use a stable key in `PasswordRules`; consider `aria-live` on the rules list; make the `AuthCard` prop types consistent.
