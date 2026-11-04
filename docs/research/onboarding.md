# Research: school onboarding (Phase 1, Part 4)

These notes come from a crawl of the PreSkool demo on 2026-11-03.

## Pages reviewed

### `school-profile.html`: useful

This is one long settings page with a section index down the side and a "Profile completeness 86%" meter. The sections are:
- **General information:** name, school code, type (co-ed, day and boarding), affiliation board, established year, current academic year and term, medium of instruction, website, email, phone, status.
- **School identity:** legal (trust) name, display name, short name, motto, founder, registration number, certificate tagline.
- **Branding:**
  - logo, dark logo, compact logo and favicon;
  - primary, secondary, success and ink colours;
  - where each asset is used (email, certificates, ID cards, reports, invoices).
- **Contact:** principal's office, reception, phone numbers by purpose, email addresses by purpose, emergency contacts.
- **Address and location:** the trust's office address, the campus address, a map pin.
- **Social media and communication:** social links, sender name and email, SMS sender ID, WhatsApp number, letterhead, quiet hours.
- **Academic details:**
  - board, grade levels (Nursery to XII), departments;
  - session type ("Annual · three terms"), working days, timings, exam pattern;
  - languages, timezone, date format, currency, week start.
- **Governance:** management people, and the trust and its committee.
- **Affiliation and compliance:** affiliation, recognition, accreditation, tax and licence numbers, each with an expiry date and a coloured "days left" marker.
- **Records:** documents, security policy, audit history.
- **Draft and publish:** "4 unpublished changes · Publish". Edits are held as a draft until published.

What Classloom takes from it:
- the idea that **the profile is the canonical record** that receipts, certificates and report cards read from;
- a completeness indicator, which becomes the setup checklist;
- identity fields: legal/trust name, short name, established year;
- the affiliation number, plus the Indian **UDISE+ code**;
- school type and day/boarding;
- medium of instruction;
- the classes offered;
- contact details and a structured address;
- the logo.

What it leaves out for now, and when that comes:
- **Leaving out entirely:**
  - multiple logo variants and brand colours: Classloom keeps its own theme;
  - draft and publish: changes apply when saved.
- **Coming in later modules:**
  - governance people, which come with Staff/HR;
  - compliance expiry tracking and documents, which come with a later documents part;
  - social links and sender identity, which come with Communication;
  - working days, timings and exam pattern, which come with Timetable and Exams.

### `academic-year.html`: placeholder

This page is a generic settings form: an institution picker, a year picker such as "2024 / 2025", and on/off switches. It has no year or term model to copy. The profile page's "Annual · three terms" and "Term 2 active" confirm the year-plus-terms idea.

### `branch-management.html` and `school-settings.html`: placeholders

These are a card grid of placeholder branches and a five-field form (name, phone, email, fax, address). They are useful only for the list layout: a card per branch with status and an Edit action.

### Shell: campus switcher

The demo's sidebar header switches between "Global International", "Sunrise Public School North branch" and "Riverside Academy West branch", plus "Add new school". Classloom already has a mock of this switcher and a mock academic-year switcher in the top bar. This part feeds both with real data.

## Indian context

- **Academic year:**
  - Nearly all CBSE, ICSE and state-board schools run from April to March; a few hill and winter schools differ, so the dates must be editable.
  - Schools split the year into **2 terms** (CBSE's Term 1 and Term 2 pattern) or **3 terms**.
- **UDISE+ code:**
  - An 11-digit number the Ministry of Education gives every school.
  - It's needed for the UDISE+ annual returns and for APAAR IDs.
  - It's digits only, and its first two digits are the state code.
- **Affiliation number:** CBSE's is 7 digits, but the format differs by board and state boards vary. Store it as text with a length cap.
- **PIN code:** 6 digits, and the first digit isn't 0.
- **Medium of instruction:** English, Hindi or a regional language. This is free text from a suggested list, because the 22 scheduled languages plus English are too many for a fixed enum to be useful.
