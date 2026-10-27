# Research: Auth (Phase 1, Part 2)

Crawled 2026-10-27 from the PreSkool demo (https://preskool.dreamstechnologies.com/html/) and the Figma kit (`DfSa4FTZIeoRuZtclag353`, Authentication page `5028:551645`).

## Pages reviewed

| Page | What it shows | Useful for Classloom? |
| --- | --- | --- |
| `login.html` (+ `-2`, `-3` variants) | "Welcome / Please enter your details to sign in"; Facebook, Google and Apple buttons; email, password with show/hide, "Remember Me", "Forgot Password?", "Create Account" link | Yes: the layout. Not the social buttons or "Create Account" (schools register at `/register-school`; people are added by their school) |
| `forgot-password.html` | One email field: "we'll email you instructions to reset your password"; "Return to Login" | Yes, with the school code added and a uniform "if an account exists" answer |
| `reset-password.html` | Old, new and confirm password | Partly: a reset from an email link must not ask for the old password. "Change password" in settings does |
| `two-step-verification.html` | "Login with your Email Address": 4 single-digit boxes, "Otp will expire in 09:59", "Verify My Account" | Yes: the OTP screen (we use 6 digits and a resend timer) |
| `email-verification.html` | "We've sent a link to your email", "Resend Link", "Skip Now" | Covered by Part 1's registration verify page; nothing new |
| `lock-screen.html` | Avatar, name, password field to unlock | No: an idle sign-out is simpler and safer on shared school computers |
| `register.html` | Name, email, password, terms | No: there is no open sign-up for people |
| `otp-settings.html` | OTP type (SMS/Email), digit count (4/5/6), expiry (2/5/10 min) | Little: we fix these values (email, 6 digits, 10 minutes); no school-level setting yet |
| `session-management.html`, `login-activity.html` | Placeholder forms and tables with dummy data | No |
| `security-settings.html` | A full account-security page (see below) | Yes: the model for "My account › Security" |

## Figma frames

- **Sign in** (`2083:412529`): centred white card (about 440 px) on the light canvas with a soft blurred primary glow, logo above, copyright below. Field labels above inputs, trailing icon in each input (mail, eye), primary full-width button.
- **2-step** (`2083:417331`): same card; heading, one-line explanation, 4 square digit boxes, a red "Otp will expire in 09:59" pill, full-width button.
- Forgot (`2083:412661`), Reset (`2083:412775`), Reset sent (`2083:412911`), Email verification (`2083:416193`) follow the same card.

## Security settings page: ideas worth keeping

The demo page is a dense "account security" dashboard. What fits a school ERP on free infrastructure:

- **Sessions list:** device (OS + browser), approximate place, IP, signed-in time, last active, "This device", "End session", "End all other sessions".
- **Login history:** each attempt with outcome (success, wrong password, locked, new device, recovery code), device, IP, time.
- **Two-factor:** authenticator app (TOTP, 6 digits, 30 s, ±1 window), 10 single-use recovery codes, "Generate new set" invalidates the old ones.
- **Lockout:** 5 failed attempts → 15-minute lock, cleared automatically.
- **Password policy:** length over complexity (at least 12 in the demo; NIST SP 800-63B says at least 8 with a breach check), no forced expiry.
- **Security emails:** sign-in from a new device, password changed, two-factor changed, account locked.
- **Session behaviour:** idle timeout, absolute lifetime, "sign out other sessions on password change".

Dropped for now: passkeys, hardware keys, biometric sign-in, SSO, personal API keys, a "security score", impossible-travel detection, IP geolocation lookups (need a paid or self-hosted database), SMS (free-tier scope).

## Constraints from earlier parts

- Registration creates the owner (`users` row + `OWNER` membership) **without a password**. The owner's first sign-in must therefore work by email OTP.
- Admin activation via the CLI leaves `users.email_verified_at` empty (tenancy follow-up).
- `users.mobile` is optional, unverified and not unique. Mobile sign-in (password only, no SMS) needs a uniqueness rule.
- Tenant context must come from the signed-in membership from Part 2 on; suspended schools must be refused at sign-in.
- Hosting: web on Vercel and the API on a different free host means **two different sites**. A refresh cookie set by the API would be a third-party cookie, which Safari (and therefore every iPhone browser) blocks. The web app has to proxy API calls so cookies stay first-party.
- `apps/web/src/lib/mock-session.ts` stands in for the session in the app shell and dashboard.
