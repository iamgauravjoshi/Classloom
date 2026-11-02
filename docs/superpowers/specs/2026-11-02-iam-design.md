# Phase 1, Part 3: IAM (users, roles and permissions)

Status: draft for review · Date: 2026-11-02 · Builds on: [Part 1: Tenancy](2026-10-26-tenancy-design.md), [Part 2a: sign-in](2026-10-27-auth-sign-in-design.md), [Part 2b: security settings](2026-11-01-auth-security-design.md) · Research: [IAM notes](../../research/iam.md)

## 1. Purpose

Today only a school's owner can sign in. This part lets the owner bring in **staff**, decide **what each person can do**, and keep sensitive accounts protected. Every later module (students, fees, attendance…) checks the permissions defined here.

### Success criteria

- An owner invites a teacher by email; the teacher joins with one click from the email and sees only what the Teacher role allows.
- A school can adjust a built-in role's permissions or create its own role, without being able to grant more than the editor holds.
- A person can hold several roles; their access is the union.
- Roles marked "require two-step" force their holders to set it up before using the app.
- Deactivating a staff member signs them out everywhere at once; an admin can reset a staff member's two-step after a lost phone.
- Every change to people, roles and permissions is recorded in an audit trail.

### Decisions already made (with the user, 2026-11-02)

| Topic             | Decision                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Roles             | Built-in roles (editable, except Owner) plus custom roles (create, clone) with a module × action grid |
| Who gets accounts | Staff only. Parents and students come with the Students module (Phase 2)                              |
| Roles per person  | Several; permissions are the union                                                                    |
| Security controls | Require two-step per role; admin resets a staff member's two-step; deactivate/reactivate staff        |
| Not chosen        | Admin-triggered password-reset emails (people use "Forgot password" themselves)                       |

## 2. Scope

**In scope:** the permission catalogue; roles, role permissions, membership roles; seeding built-in roles; API permission enforcement; staff invitations and joining; the Users & roles screens; required two-step per role; deactivate, reactivate, change roles, reset two-step; an audit trail of IAM changes; the session's `roles` and `permissions`.

**Out of scope:** parent/student accounts (Phase 2); limiting a person to certain campuses (Part 4 adds campuses); the audit log viewer (Part 6); departments, staff profiles and HR data (Staff module, Phase 3); bulk import/export; admin-triggered password emails; SSO.

## 3. Concepts

| Term                      | Meaning                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Permission**            | A key `module.action`, e.g. `students.view`. Defined in code (contracts); never created by schools.                               |
| **Role**                  | A named set of permissions within one school. **Built-in** roles have a fixed `key` (e.g. `TEACHER`); **custom** roles have none. |
| **Owner**                 | The built-in role with every permission. It cannot be edited or deleted; a school always has at least one active owner.           |
| **Effective permissions** | The union of the permissions of a person's roles at one school (Owner = all).                                                     |
| **Invitation**            | A pending offer for an email address to join a school with chosen roles.                                                          |
| **Audit event**           | A record of an IAM change: who, what, to whom, before and after.                                                                  |

## 4. Permission catalogue

Defined once in `@classloom/contracts` (`PERMISSION_CATALOGUE`) as modules with their allowed actions, so the grid never shows meaningless boxes. Actions: `view`, `create`, `edit`, `delete`, `export`, `approve`, `manage`.

| Module (key)                    | Actions                                     |
| ------------------------------- | ------------------------------------------- |
| Dashboard (`dashboard`)         | view                                        |
| Students (`students`)           | view, create, edit, delete, export          |
| Admissions (`admissions`)       | view, create, edit, delete, approve, export |
| Parents (`parents`)             | view, create, edit, delete                  |
| Staff (`staff`)                 | view, create, edit, delete, export          |
| Classes & sections (`classes`)  | view, manage                                |
| Subjects (`subjects`)           | view, manage                                |
| Timetable (`timetable`)         | view, manage                                |
| Attendance (`attendance`)       | view, create, edit, export                  |
| Exams & results (`exams`)       | view, create, edit, approve, export         |
| Fees (`fees`)                   | view, create, edit, approve, export         |
| Library (`library`)             | view, manage                                |
| Transport (`transport`)         | view, manage                                |
| Communication (`communication`) | view, create, approve                       |
| Reports (`reports`)             | view, export                                |
| School settings (`settings`)    | view, manage                                |
| Users & roles (`iam`)           | view, manage                                |

- Keys are lowercase `module.action`. The existing nav permission keys (e.g. `students.read`, `iam.users`, `settings.school`) are renamed to catalogue keys in `apps/web/src/config/nav.ts`.
- A later module adds its own entries; removing a key needs a migration that deletes it from `role_permissions`.
- `manage` implies `view` in the grid UI (ticking manage ticks view); the API stores what is ticked.

## 5. Built-in roles and defaults

Created for every school at registration and, by migration, for every existing school. Defaults (the school can change any role except Owner; "Reset to default" restores this table):

| Role (key)                              | Default permissions                                                                                                                                        | Requires two-step |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Owner (`OWNER`)                         | All (fixed)                                                                                                                                                | Yes               |
| Principal (`PRINCIPAL`)                 | All except `iam.manage` and `settings.manage`                                                                                                              | Yes               |
| Admin (`ADMIN`)                         | All                                                                                                                                                        | Yes               |
| Accountant (`ACCOUNTANT`)               | dashboard.view, students.view, parents.view, fees.*, reports.view, reports.export                                                                          | Yes               |
| Teacher (`TEACHER`)                     | dashboard.view, students.view, classes.view, subjects.view, timetable.view, attendance.view/create/edit, exams.view/create/edit, communication.view/create | No                |
| Class Teacher (`CLASS_TEACHER`)         | Teacher's, plus students.edit, attendance.export, exams.approve, parents.view                                                                              | No                |
| Librarian (`LIBRARIAN`)                 | dashboard.view, students.view, staff.view, library.*                                                                                                       | No                |
| Receptionist (`RECEPTIONIST`)           | dashboard.view, admissions.view/create/edit, students.view, parents.view/create, communication.view                                                        | No                |
| Transport Manager (`TRANSPORT_MANAGER`) | dashboard.view, students.view, transport.*                                                                                                                 | No                |

(`x.*` means every action the catalogue lists for that module.) Built-in roles cannot be deleted or renamed; their description and permissions can be edited.

## 6. Data model

All new tables are **tenant-owned and row-level secured** (forced RLS, added to `TENANT_SCOPED_MODELS`), like `campuses`.

### Role (`roles`)

| Column                     | Type    | Rules                                                                                     |
| -------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `id`, `tenant_id`          | uuid    |                                                                                           |
| `key`                      | text?   | Built-in key (section 5); null for custom roles. Unique `(tenant_id, key)` where not null |
| `name`                     | text    | 2–40 chars; unique per tenant, case-insensitive                                           |
| `description`              | text?   | ≤ 200 chars                                                                               |
| `requires_two_factor`      | boolean | Default per section 5; false for new custom roles                                         |
| `created_at`, `updated_at` |         |                                                                                           |

### Role permission (`role_permissions`)

`role_id` (FK cascade), `tenant_id`, `permission` (text, a catalogue key). PK `(role_id, permission)`. The Owner role has **no rows**: it means "all", computed in code, so new catalogue keys reach owners automatically.

### Membership role (`membership_roles`)

`membership_id` (FK cascade), `role_id` (FK restrict), `tenant_id`, `assigned_at`, `assigned_by` (user id, null for system). PK `(membership_id, role_id)`. A role still assigned to someone can't be deleted (`409`).

### Membership (`memberships`): changes

- `role` column (enum `OWNER`) is **migrated** into `membership_roles` (Owner) and then dropped, with the `MembershipRole` enum.
- `status` gains `DEACTIVATED` (`ACTIVE`, `REVOKED`, `DEACTIVATED`). `REVOKED` stays for the registration cancel path; `DEACTIVATED` is reversible.
- New `deactivated_at timestamptz?`.

### Invitation (`invitations`)

| Column                      | Type         | Rules                                                             |
| --------------------------- | ------------ | ----------------------------------------------------------------- |
| `id`, `tenant_id`           | uuid         |                                                                   |
| `email`                     | citext       | Normalised                                                        |
| `name`                      | text         | 2–80 chars                                                        |
| `role_ids`                  | uuid[]       | ≥ 1; validated against the tenant's roles at accept time          |
| `token_hash`                | bytea        | Unique; SHA-256 of 32 random bytes                                |
| `expires_at`                | timestamptz  | Created + 7 days (re-sending issues a new token and a new expiry) |
| `invited_by`                | uuid         | User id                                                           |
| `accepted_at`, `revoked_at` | timestamptz? |                                                                   |

At most one open invitation (not accepted, revoked or expired) per `(tenant_id, email)`.

**Lookup before a tenant context:** accepting reads an invitation by token, before any tenant is known. That read goes through an owner-defined `SECURITY DEFINER` function `invitation_by_token(bytea)` returning only `(id, tenant_id)`, following Part 1's pattern; the rest runs under `withTenant`.

### Audit event (`audit_events`)

| Column             | Type   | Rules                                                                                                                                                                                                                                         |
| ------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `tenant_id`  | uuid   |                                                                                                                                                                                                                                               |
| `actor_user_id`    | uuid?  | Null for system and CLI                                                                                                                                                                                                                       |
| `action`           | text   | One of: `role.created`, `role.updated`, `role.deleted`, `role.permissions_changed`, `member.invited`, `member.invite_revoked`, `member.joined`, `member.roles_changed`, `member.deactivated`, `member.reactivated`, `member.two_factor_reset` |
| `target_type`      | text   | `role`, `membership`, `invitation`                                                                                                                                                                                                            |
| `target_id`        | uuid   |                                                                                                                                                                                                                                               |
| `before`, `after`  | jsonb? | Changed fields only (permission lists, role ids, status)                                                                                                                                                                                      |
| `ip`, `user_agent` |        | As in `auth_events`                                                                                                                                                                                                                           |
| `created_at`       |        | Append-only: the app role gets `INSERT, SELECT` only (no `UPDATE`, `DELETE`)                                                                                                                                                                  |

Written in the same transaction as the change it records.

## 7. Enforcement

- **Session:** `SessionMiddleware` (Part 2a) loads the membership's roles and computes effective permissions once per request; `request.auth` gains `roles: { id, key, name }[]`, `permissions: ReadonlySet<string>` and `isOwner`. `RequestAuth.role` is removed.
- **API:** a `@RequirePermission(...keys)` decorator and a global `PermissionGuard` (after `AuthGuard`) answer `403` (`type: permission-denied`) unless the person holds **all** listed keys. Routes without the decorator need only a session (e.g. `/me/*`).
- **`AuthSession`** (contracts) replaces `role` with `roles: { key: string | null, name }[]` and `permissions: string[]`. The web shell filters nav and actions with it (the existing `nav-filter.ts` logic).
- **No escalation:** a person may assign a role, or tick a permission on a role, only if every permission involved is in their own effective permissions. Only owners may assign or remove the Owner role. Enforced in the service layer, not just the UI.
- **Last owner:** the last active owner can't be deactivated, lose the Owner role, or leave; `409` (`type: last-owner`).
- **Self-protection:** a person can't deactivate themselves or reset their own two-step from the Users screen (they use My account › Security). Because the last-owner rule always leaves an active owner, someone with every permission can always manage the school.
- **Changes take effect on the next request** (permissions are computed per request); no re-sign-in needed.

## 8. Invitations and joining

### API

| Method & path                       | Permission   | Body / notes                                                                                                                                          |
| ----------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /iam/invitations`              | `iam.view`   | Open invitations                                                                                                                                      |
| `POST /iam/invitations`             | `iam.manage` | `{ email, name, roleIds }` → `201`; `409` already a member (`type: already-member`) or already invited (`type: already-invited`); no-escalation check |
| `POST /iam/invitations/{id}/resend` | `iam.manage` | New token and expiry; old link stops working; max 3 per day per invitation                                                                            |
| `POST /iam/invitations/{id}/revoke` | `iam.manage` | `204`                                                                                                                                                 |
| `GET /invitations/preview?token=`   | public       | `200 { school: { code, name }, email (masked), name, roles: string[] }`; `410` expired/used/revoked/unknown (one response)                            |
| `POST /invitations/accept`          | public       | `{ token }` → `200 AuthSession` + session cookie (or `202` two-factor challenge); `410` as above                                                      |

operationIds: `listInvitations`, `createInvitation`, `resendInvitation`, `revokeInvitation`, `previewInvitation`, `acceptInvitation`.

### Accepting

1. The email links to `${WEB_ORIGIN}/en/join?token=…`. The page strips the token from the address bar, calls **preview**, and shows "Join **Global International School** as Teacher, Class Teacher" with a **Join** button. The token is spent only by **accept** (scanner-safe, as in Parts 1 and 2a).
2. **Accept** (in one transaction under the invitation's tenant):
   - Find or create the user by the invitation's email (new users get the invitation's name); set `email_verified_at` if empty (the email link proves the address).
   - If a membership exists: `ACTIVE` → `409 already-member`; `DEACTIVATED`/`REVOKED` → reactivate it with the invited roles. Otherwise create it.
   - Assign the invited roles (roles deleted since the invite are skipped; if none remain → `410`).
   - Mark the invitation accepted; write `member.joined`.
3. Then sign the person in through Part 2b's `completeFirstFactor` (method `INVITE`, a new `AuthMethod` value): two-step users from untrusted devices get the 202 challenge; others get a session.
4. The web app shows "Welcome to Global International School" and, if the user has no password, offers **Set a password** (My account) or **Continue**.

If the invited email belongs to someone signed in as a different person in that browser, the page says "This invitation is for a…@example.com" and offers **Sign out and join**.

### Email

"You're invited to join Global International School on Classloom": inviter's name, roles, **Join** button and link, "This invitation expires on 9 Nov 2026", and "If you weren't expecting this, you can ignore it." Sent through the existing queue; job data holds the link, so failed jobs are kept at most 7 days.

## 9. Managing people and roles

### Members API

| Method & path                                       | Permission   | Notes                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /iam/members?search=&roleId=&status=&cursor=`  | `iam.view`   | `{ members: [{ membershipId, userId, name, email, roles, status, twoFactorEnabled, lastSignInAt }], nextCursor }`, 25 per page, sorted by name                                                                                                        |
| `PUT /iam/members/{membershipId}/roles`             | `iam.manage` | `{ roleIds }` (≥ 1); no-escalation; last-owner                                                                                                                                                                                                        |
| `POST /iam/members/{membershipId}/deactivate`       | `iam.manage` | Revokes all the person's sessions at this school (`SessionRevokedReason.MEMBER_DEACTIVATED`)                                                                                                                                                          |
| `POST /iam/members/{membershipId}/reactivate`       | `iam.manage` |                                                                                                                                                                                                                                                       |
| `POST /iam/members/{membershipId}/reset-two-factor` | `iam.manage` | Requires the **admin's** recent sign-in (10 min). Clears the person's two-step, codes and device trust; revokes their sessions at every school; emails them; `member.two_factor_reset`. The target must not be an owner unless the actor is an owner. |

operationIds: `listMembers`, `setMemberRoles`, `deactivateMember`, `reactivateMember`, `resetMemberTwoFactor`.

`lastSignInAt` comes from the person's latest `SIGN_IN_SUCCEEDED` event at this school.

### Roles API

| Method & path                | Permission   | Notes                                                                                                                                                       |
| ---------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /iam/roles`             | `iam.view`   | `{ roles: [{ id, key, name, description, requiresTwoFactor, permissions, memberCount }] }`                                                                  |
| `GET /iam/permissions`       | `iam.view`   | The catalogue (modules, actions, keys, labels' i18n keys)                                                                                                   |
| `POST /iam/roles`            | `iam.manage` | `{ name, description?, permissions, requiresTwoFactor, cloneFromRoleId? }` → `201`                                                                          |
| `PUT /iam/roles/{id}`        | `iam.manage` | `{ name?, description?, permissions?, requiresTwoFactor? }`; built-in: name not editable; Owner: only `requiresTwoFactor` is editable, and only by an owner |
| `POST /iam/roles/{id}/reset` | `iam.manage` | Built-in only: restore section 5's defaults                                                                                                                 |
| `DELETE /iam/roles/{id}`     | `iam.manage` | Custom only; `409` while assigned                                                                                                                           |

operationIds: `listRoles`, `listPermissions`, `createRole`, `updateRole`, `resetRole`, `deleteRole`.

Unknown permission keys → `400`. Every write records an audit event.

### Rate limits

IAM mutations: 60 per hour per user (Redis counter, as Part 2b's mutation limits). Invitations: 50 per day per school.

## 10. Required two-step

- At session creation (any first factor or invite accept), if any of the person's roles at that school has `requires_two_factor` and they have no two-step: the session is created with `two_factor_setup_required = true` (new column on `sessions`).
- While set, the API allows only: `GET /auth/session`, `POST /auth/sign-out`, `GET /me`, `GET /me/two-factor`, `POST /me/two-factor/setup|enable`. Anything else → `403` (`type: two-factor-setup-required`).
- `enable` clears the flag on the current session (and all the user's sessions with it set).
- The requirement is re-evaluated on every request, alongside permissions, so if a role starts requiring two-step later, people already signed in are flagged on their next request. The stored flag only records the state at sign-in.
- **After this part ships**, existing owners will be asked to set up two-step on their next request (Owner requires it by default). An owner can turn the requirement off on the Owner role.
- `AuthSession` gains `twoFactorSetupRequired: boolean`. The web app sends such sessions to `/[locale]/setup-two-factor`: an explanation ("Your school requires two-step sign-in for your role"), then Part 2b's setup dialog content as a page, then on to `next`.

## 11. Web

### Users & roles (`/[locale]/users-roles`, permission `iam.view`)

Two tabs: **Members** and **Roles**. Actions appear only with `iam.manage`.

- **Members:** search, role filter, status filter (Active, Invited, Deactivated). Rows: avatar initials, name, email, roles (pills), status, two-step (On/Off), last sign-in. Row menu: Change roles, Deactivate / Reactivate, Reset two-step. Pending invitations appear in the same list with status "Invited" and menu Resend / Revoke. "Invite people" button opens a dialog (email, name, roles multi-select). Table from `md` up, cards below.
- **Roles:** cards or rows with name, built-in/custom badge, member count, permission count ("42 of 64"), "Requires two-step" badge. "Create role" and per-role "Clone", "Edit", "Reset to default" (built-in), "Delete" (custom).
- **Role editor** (`/[locale]/users-roles/roles/[id]` and `/new`): name, description, "Require two-step sign-in" switch, then the grid: one row per module with its actions as checkboxes, a per-module "x of y" count, "Select all" per module, and presets (Read only = all `view`; Editor = view/create/edit; Manager = everything except delete and `iam.*`; Full access). Permissions the editor doesn't hold are shown disabled with a tooltip "You can't grant a permission you don't have." Owner's page is read-only.
- Confirmations: deactivate ("Deactivate Anita Sharma? She'll be signed out now and can't sign in to this school until reactivated."), reset two-step, delete role.

### Join (`/[locale]/join`, public) and two-step setup (`/[locale]/setup-two-factor`)

As in sections 8 and 10.

### Navigation

`nav.ts` uses catalogue keys; the shell already hides items the session lacks. The dashboard and placeholder module pages require their module's `view` (`403` page "You don't have access to this page" otherwise).

All copy in `messages/en.json`; axe WCAG 2.1 AA in light and dark; 44 px touch targets; 375 px without horizontal scroll.

## 12. Errors and edge cases

| Situation                                                       | Behaviour                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Invited email already belongs to an active member               | `409 already-member` at invite; accept also answers `409` if it became true meanwhile      |
| Invite link opened after it was resent                          | Old token → `410`; the page offers nothing but "Ask the school to send a new invitation"   |
| A role in the invitation was deleted before accepting           | Skipped; if none remain → `410`                                                            |
| Admin edits a role to drop a permission they're using right now | Takes effect on their next request; the UI refreshes the session                           |
| Deactivated person tries to sign in                             | Treated as no membership: the same "incorrect" response as Part 2a (no enumeration)        |
| Person deactivated at one school, active at another             | Only that school's sessions end; their account and other schools are untouched             |
| Reset two-step on someone with no two-step                      | `409`                                                                                      |
| Two admins change the same role at once                         | Last write wins; both writes audited                                                       |
| Catalogue key removed in a later release                        | Its migration deletes the key from `role_permissions`; the API ignores unknown stored keys |

## 13. Migration

1. Create the new tables, RLS policies, the `invitation_by_token` function, the `sessions.two_factor_setup_required` column, the `DEACTIVATED` status, `AuthMethod.INVITE`, `SessionRevokedReason.MEMBER_DEACTIVATED`.
2. For every tenant, insert the built-in roles with section 5's defaults (a SQL function `seed_builtin_roles(tenant_id)` that registration also calls).
3. For every membership, insert `membership_roles` Owner; then drop `memberships.role` and the enum.

The defaults exist twice: as `BUILT_IN_ROLE_DEFAULTS` in contracts (used by "Reset to default" and the UI) and inside the SQL seeding function. An integration test seeds a tenant and asserts the rows equal `BUILT_IN_ROLE_DEFAULTS`, so the two can't drift.

## 14. Testing

| Level                                            | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                                             | Catalogue keys well-formed and unique; defaults reference only catalogue keys; Owner = all; union of roles; no-escalation subset check; last-owner rule; presets; `manage` ticks `view` in the grid helper                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Integration                                      | Every IAM route returns `403` without its permission and works with it; a teacher gets `403` on `iam.*`; escalation refused (assigning Owner as non-owner, ticking a permission not held); last-owner refused; invite → preview → accept for a new and an existing user (other school), reactivating a deactivated membership; expired, revoked, resent and reused tokens → `410`; `409 already-member`; accept with two-step on → 202; deactivate ends sessions immediately and sign-in then fails as "incorrect"; reset two-step clears it, ends sessions, emails, needs the admin's recent sign-in; required two-step flags the session and only the allowed routes work, `enable` clears it; audit rows written in the same transaction (and not updatable by the app role); RLS: school A can't see or change school B's roles, members, invitations or audit events; migration seeds roles for existing tenants and moves owners |
| E2E (6 device projects + axe light/dark, 375 px) | Owner invites a teacher; teacher joins from Mailpit's link, sets a password, sees only Teacher menu items and gets the 403 page on Users & roles; owner adds Accountant (requires two-step) → teacher's next navigation lands on the two-step setup page and completes it; owner creates a custom role by cloning Teacher and ticking `fees.view`; owner deactivates the teacher → teacher's tab lands on sign-in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## 15. Acceptance checklist

- [ ] Migration seeds built-in roles for existing schools and moves owners; runs on a Part 2b database.
- [ ] Permissions are enforced on the API and reflected in the nav for every role.
- [ ] Invite → join works for new and existing people, on every device project.
- [ ] Custom roles can be created, cloned, edited and deleted; built-in roles edited and reset; Owner untouchable.
- [ ] No escalation and last-owner rules hold under test.
- [ ] Required two-step, deactivate/reactivate and admin two-step reset work.
- [ ] Audit events are written for every IAM change.
- [ ] All copy in i18n files; axe clean in light and dark; CI green.
