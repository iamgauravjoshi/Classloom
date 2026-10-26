# Research: Tenancy (Phase 1, Part 1)

Crawled 2026-10-26 from the PreSkool demo (https://preskool.dreamstechnologies.com/html/).

## Pages reviewed

| Page | What it shows | Useful for Classloom? |
| --- | --- | --- |
| `index.html` (sidebar header) | School switcher: "Global International (Primary campus)", "Sunrise Public School (North branch)", "Riverside Academy (West branch)", "Add new school" | Yes: campus switcher at the top of the sidebar (already in the Phase 0 shell) |
| `tenant-settings.html` | Institution picker, academic year, primary contact, support email, three toggles (enable, notify admins, require approval) | Little: generic placeholder form |
| `branch-management.html` | Card grid of "Branch Management N" items with reference, members, status | No: placeholder data |
| `franchise-setup.html` | Same placeholder card grid | No |
| `central-dashboard.html` | Table of branches with students, staff, revenue, status | Later: a trust-level overview once campuses hold real data |
| `school-profile.html` | Full school record (see below) | Yes, mostly for the Part 4 onboarding wizard |

## School Profile: fields worth keeping

The page's key idea: *everything the system prints or sends on the school's behalf is drawn from this one profile* (certificates, ID cards, invoices, reports, letters).

- **General:** school name, school code (`PIS-2011-KA`), school type (co-ed; day/boarding), affiliation board (CBSE), established year, academic year, medium of instruction, website, official email, phone, status.
- **Identity:** legal name (trust), display name, short name, motto, founder, registration number.
- **Branding:** logo (light, dark, compact), favicon, primary/secondary/ink colours, where branding applies (email, certificates, ID cards, reports, invoices).
- **Contact:** office numbers, admissions/transport lines, emergency contact, office and campus addresses, map pin, social links.
- **Communication:** sender name/email, reply-to, SMS sender ID, WhatsApp number, quiet hours.
- **Academic:** board, grade levels (Nursery–XII), departments, session type (annual, three terms), working days, timings, exam pattern, timezone (Asia/Kolkata), date format, currency (INR).
- **Governance:** principal, vice principal, chairman, trust registration, management committee; affiliation/recognition numbers with expiry dates and alerts.
- **Records:** documents, security policy (2FA for admins, password policy, session timeout), audit history with before/after values.

## Decisions for Part 1

- Part 1 stores only the core record needed to exist and be found: name, code, board, city, state, contact email, status, plus a primary campus. The rest of the profile above belongs to the Part 4 onboarding wizard.
- PreSkool's "Add new school" from inside an existing school is replaced by public self-registration, as decided with the user on 2026-10-26.
- Branch/franchise screens are not copied; campuses inside one school account cover the same need.
