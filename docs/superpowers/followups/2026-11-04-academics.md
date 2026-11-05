# Academic structure (Phase 1, Part 5): follow-ups

These items come from the per-task reviews and the final whole-branch review. None of them block merge.

The build decisions are recorded in the spec: `docs/superpowers/specs/2026-11-04-academics-design.md`.

## For your local setup

- `pnpm db:migrate` applies the academics migration. Your local dev database is already migrated.
- After this deploys, every school's setup checklist shows a fifth item, "Add sections and class subjects".
- `school:demo-setup <code>` now also adds streams, rooms, sections, the board's starter subjects and some class-subject mappings.

## Accessibility follow-up (separate PR)

- **Button hover contrast:** the shared primary button's hover colour (`bg-primary/80`) gives about 3.7:1 for white text in light mode, below AA. Give it an opaque hover token in `packages/ui`, then remove the `page.mouse.move(0, 0)` workarounds in `apps/web/e2e/a11y.spec.ts`.

## Behaviour to tidy

- **Copy-forward:**
  - The "Copy N sections" offer appears late, and is silently missing if the previous-year query fails.
  - Copy can create senior sections without a stream when last year's stream was archived (reported in the copy summary).
- **Lost focus:**
  - Focus is lost after a failed class-subject save (the cell is disabled while saving).
  - The "replace" focus also drifts on some list actions.
- **Messages:**
  - The section label in "teacher already leads" doesn't name the campus.
  - The starter-subject picker only ticks items; codes and types can't be edited before adding.
- **Demo setup:** `school:demo-setup` gives no reason when every class-subject row or section is skipped (for example, non-CBSE subject names).
- **Locking:** archiving a room isn't locked against a section being created at the same moment. The outcome is allowed, because sections keep archived rooms.

## Tests to add

- **API:**
  - Copy-forward with several earlier years, or overlapping years.
  - A race between make-primary and deactivate on the same campus (from Part 4's list).
  - A parse test for `classSubjectsResponseSchema`.
  - The `outsideRange` flag in the class-subjects PUT response when no range is set.
- **Web, read-only views:** a11y coverage of the subjects pages for a view-only role, and the in-use and limit sentences as rendered.
- **Web, mobile:**
  - The mobile accordion "Remove all" in the a11y spec.
  - Driving the stream selector at 375 px.
- **Flaky:** Mailpit email timeouts under bursty parallel runs, and Firefox's NS_BINDING_ABORTED in onboarding.spec.

## Code tidying

- **Schema:**
  - A schema test asserts nothing extra on the second-campus room insert.
  - The `rooms.floor` CHECK allows `''` (contracts trim it to null).
- **Problem types:** unknown or other-school ids in a class-subjects PUT use an untyped 422; a typed problem would be cleaner.
- **Web:**
  - The `refusedRow` i18n placeholder is named `subject` but is also used for streams.
  - A stray JSDoc order in `sections-tab.tsx`.
  - A long doc line in `checklist-card.tsx`.
