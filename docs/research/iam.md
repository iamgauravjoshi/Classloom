# Research: IAM (Phase 1, Part 3)

These notes come from a crawl of the PreSkool demo on 2026-11-02.

## Pages reviewed

### `roles-permission.html`: useful

This page holds the role directory.
- **Built-in roles:** 14 in all, among them Administrator, Principal, Vice Principal, Teacher, Class Teacher, Student, Parent, Accountant, HR, Librarian, Receptionist, Transport Manager, Hostel Manager and Exam Controller.
- **Custom roles:** "Create Role" and "Clone Role".
- **Role list:** each role shows its user count, permission count and when it was last updated.
- **Permission grid:** each module has 10 actions (View, Create, Edit, Delete, Import, Export, Approve, Print, Download, Manage), with "x / 10 enabled" per module.
- **Grid presets:** Read Only, Editor, Manager and Full Access.
- **Other panels:** user assignment, audit history, and a "security panel" with a score.

What Classloom takes from it:
- the model of built-in plus custom roles;
- clone and presets;
- per-module counts;
- an audit trail.

What it leaves out:
- the security score;
- the "Compare" and approval workflow;
- a uniform 10-action grid. Classloom lists only the combinations that make sense.

### `users.html`: useful

- **List columns:** user list with role, department, email, phone, branch, status (Active, Pending/Invited, Inactive, Blocked, Suspended), last login and created date.
- **Actions:** filters, saved views, and bulk actions (activate, deactivate, assign role, reset password, export).
- **Counters and alerts:** pending invitations with an expiry, and "multiple failed logins" alerts.

What Classloom takes from it:
- the list with roles, status, two-step state and last sign-in;
- invite with expiry;
- deactivate and reactivate.

Deferred:
- saved views, bulk actions, departments and branch filters (campuses come in Part 4);
- import and export (Staff module).

### `staffs.html`: not used now

This is the Staff module's list, covering HR data. Classloom's Staff module (Phase 3) owns it, and IAM only manages access.

## Indian school context

- Staff often hold several duties at once, for example a teacher who is also a class teacher and the librarian. So one person can have several roles.
- Many schools have no IT staff. The owner (principal or trustee) needs ready-made roles that work out of the box, and editing should be optional.
- Fee collection and student records are sensitive, so Accountant and Admin should require two-step sign-in by default.
