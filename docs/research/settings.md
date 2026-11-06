# Research: settings framework (Phase 1, Part 6)

These notes come from a crawl of the PreSkool demo on 2026-11-06.

## Pages reviewed

### `prefixes.html`: a placeholder layout

This is one settings form with a prefix input per record type: Students, Teachers, Parents, Guardians, Subjects, Class, Sections, Home Work, Department, Designation, Notice Board, Attendance, Time Table, Sports, Syllabus and Class Room. There's no counter, year or reset model to copy.

### `custom-fields.html`: very detailed (for Part 6b)

- **A field library** is bound to modules (`student.custom`, `admission.custom` and so on), with drafts and publishing.
- **Fields:** 27 field types. Validation covers required, min/max length, regex, unique, read-only, hidden, default and help text.
- **Forms:** conditional and role-based visibility rules, field groups and form layout.
- **Lifecycle:** archive rather than delete, and "sensitive" fields excluded from exports.

Most of this belongs after Phase 2, when real forms exist.

### `email-templates.html`: a placeholder (for Part 6b)

A list of template names (verification, welcome, reminders, policy updates), each with an editor.

### `activity-logs.html`: useful for the layout

A table of event, user, date and IP, with status filters, PDF/Excel export and paging.

## What Classloom takes for 6a

- **Numbering:** per-document numbering, extended with Indian register conventions (below).
- **Activity log:** a filterable, exportable list. Classloom's version reads the real audit trail written by Parts 3–5, with before and after values.

## Indian context

- **Admission number:** the admission register number is usually permanent and runs on across years, for example 4812, 4813… Some schools print it with a year, like `ADM/2026-27/0012`.
- **Receipts and enquiries:** these usually restart each academic year, as April–March registers.
- **Paper registers:** schools moving from paper continue from their last register number, so the next number must be settable. It can only be raised, so numbers can never repeat.
