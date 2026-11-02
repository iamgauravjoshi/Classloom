-- IAM (Part 3). Spec: docs/superpowers/specs/2026-11-02-iam-design.md, sections 5, 6 and 13.
-- Generated DDL from `prisma migrate diff`, then edited by hand: the column drop is moved after
-- the data migration, and CHECK constraints, row-level security, the audit grants, the two
-- functions and the owner move are added. Order matters: nothing about the old `role` column is
-- dropped until every membership holds the Owner role, and a check aborts the migration (rolling
-- it back) if any does not.

-- ---------------------------------------------------------------------------------------------
-- 1. New enum values and columns.
-- ---------------------------------------------------------------------------------------------
-- (Not used later in this migration: a value added here cannot be used in the same transaction.)
ALTER TYPE "SessionRevokedReason" ADD VALUE 'MEMBER_DEACTIVATED';
ALTER TYPE "AuthMethod" ADD VALUE 'INVITE';
ALTER TYPE "MembershipStatus" ADD VALUE 'DEACTIVATED';

ALTER TABLE "sessions" ADD COLUMN "two_factor_setup_required" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "memberships" ADD COLUMN "deactivated_at" TIMESTAMPTZ(6);

-- ---------------------------------------------------------------------------------------------
-- 2. Tables.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT,
    "name" CITEXT NOT NULL,
    "description" TEXT,
    "requires_two_factor" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "roles_key_check" CHECK ("key" IS NULL OR "key" IN (
      'OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'CLASS_TEACHER', 'LIBRARIAN',
      'RECEPTIONIST', 'TRANSPORT_MANAGER')),
    CONSTRAINT "roles_name_check" CHECK (char_length("name") BETWEEN 2 AND 40),
    CONSTRAINT "roles_description_check" CHECK (char_length("description") <= 200)
);

CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission"),
    CONSTRAINT "role_permissions_permission_check"
      CHECK ("permission" ~ '^[a-z]+\.(view|create|edit|delete|export|approve|manage)$')
);

CREATE TABLE "membership_roles" (
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" UUID,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("membership_id","role_id")
);

CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role_ids" UUID[],
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "invited_by" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
    -- Prisma declares list columns nullable; the CHECK makes "at least one role" hold anyway.
    CONSTRAINT "invitations_role_ids_check"
      CHECK ("role_ids" IS NOT NULL AND cardinality("role_ids") >= 1),
    CONSTRAINT "invitations_name_check" CHECK (char_length("name") BETWEEN 2 AND 80),
    CONSTRAINT "invitations_token_hash_check" CHECK (octet_length("token_hash") = 32)
);

CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_events_action_check" CHECK ("action" IN (
      'role.created', 'role.updated', 'role.deleted', 'role.permissions_changed',
      'member.invited', 'member.invite_revoked', 'member.joined', 'member.roles_changed',
      'member.deactivated', 'member.reactivated', 'member.two_factor_reset')),
    CONSTRAINT "audit_events_target_type_check"
      CHECK ("target_type" IN ('role', 'membership', 'invitation'))
);

-- ---------------------------------------------------------------------------------------------
-- 3. Indexes and foreign keys.
-- ---------------------------------------------------------------------------------------------
-- (tenant_id, key) leaves custom roles (key NULL) unconstrained: NULLs are distinct.
CREATE UNIQUE INDEX "roles_tenant_id_key_key" ON "roles"("tenant_id", "key");
-- citext: unique per school, ignoring case.
CREATE UNIQUE INDEX "roles_tenant_id_name_key" ON "roles"("tenant_id", "name");
CREATE UNIQUE INDEX "roles_id_tenant_id_key" ON "roles"("id", "tenant_id");
CREATE INDEX "role_permissions_tenant_id_idx" ON "role_permissions"("tenant_id");
CREATE INDEX "membership_roles_role_id_idx" ON "membership_roles"("role_id");
CREATE INDEX "membership_roles_tenant_id_idx" ON "membership_roles"("tenant_id");
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");
CREATE INDEX "invitations_tenant_id_email_idx" ON "invitations"("tenant_id", "email");
CREATE INDEX "audit_events_tenant_id_created_at_idx" ON "audit_events"("tenant_id", "created_at" DESC);
CREATE UNIQUE INDEX "memberships_id_tenant_id_key" ON "memberships"("id", "tenant_id");

ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The composite keys keep a row inside one school: foreign key checks bypass row-level security,
-- so a single-column key would let a school's row point at another school's role or membership.
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_tenant_id_fkey" FOREIGN KEY ("role_id", "tenant_id") REFERENCES "roles"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_id_tenant_id_fkey" FOREIGN KEY ("membership_id", "tenant_id") REFERENCES "memberships"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
-- NO ACTION, not RESTRICT: a role still held by someone cannot be deleted, but deleting a whole
-- school (which cascades to both roles and membership_roles in one statement) still works,
-- because NO ACTION is checked at the end of the statement.
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_role_id_tenant_id_fkey" FOREIGN KEY ("role_id", "tenant_id") REFERENCES "roles"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- 4. Row-level security, as for campuses and memberships: with no `app.tenant_id` set the app
--    role sees and writes nothing. The owner role bypasses it (BYPASSRLS) for migrations and the CLI.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "roles"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "role_permissions"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "membership_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "membership_roles"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "invitations"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "audit_events"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Append-only: the default privileges (01-roles.sql) grant the app role UPDATE and DELETE on every
-- new table; the audit trail keeps INSERT and SELECT only.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_events" FROM classloom_app;

-- ---------------------------------------------------------------------------------------------
-- 5. seed_builtin_roles(tenant): the nine built-in roles with section 5's defaults.
-- ---------------------------------------------------------------------------------------------
-- These defaults also exist as BUILT_IN_ROLE_DEFAULTS in @classloom/contracts; the integration
-- test test/iam/schema.int.test.ts seeds a school and compares it with them, so they can't drift.
-- The Owner role gets no permission rows: it means every permission, computed in code.
--
-- SECURITY INVOKER (the default) on purpose: registration calls it as the app role inside the new
-- school's tenant context, so row-level security confines it to that school; the migration below
-- calls it as the owner role. Fails on a school that already has the built-in roles.
CREATE FUNCTION seed_builtin_roles(p_tenant_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = public, pg_temp
AS $$
  WITH defaults (key, name, description, requires_two_factor, permissions) AS (
    VALUES
      ('OWNER', 'Owner',
       'Has full control of the school, including users and roles.',
       true, ARRAY[]::text[]),
      ('PRINCIPAL', 'Principal',
       'Oversees the whole school but cannot manage users or school settings.',
       true, ARRAY[
         'dashboard.view',
         'students.view', 'students.create', 'students.edit', 'students.delete', 'students.export',
         'admissions.view', 'admissions.create', 'admissions.edit', 'admissions.delete',
         'admissions.approve', 'admissions.export',
         'parents.view', 'parents.create', 'parents.edit', 'parents.delete',
         'staff.view', 'staff.create', 'staff.edit', 'staff.delete', 'staff.export',
         'classes.view', 'classes.manage',
         'subjects.view', 'subjects.manage',
         'timetable.view', 'timetable.manage',
         'attendance.view', 'attendance.create', 'attendance.edit', 'attendance.export',
         'exams.view', 'exams.create', 'exams.edit', 'exams.approve', 'exams.export',
         'fees.view', 'fees.create', 'fees.edit', 'fees.approve', 'fees.export',
         'library.view', 'library.manage',
         'transport.view', 'transport.manage',
         'communication.view', 'communication.create', 'communication.approve',
         'reports.view', 'reports.export',
         'settings.view',
         'iam.view']),
      ('ADMIN', 'Admin',
       'Runs the school office with access to every module.',
       true, ARRAY[
         'dashboard.view',
         'students.view', 'students.create', 'students.edit', 'students.delete', 'students.export',
         'admissions.view', 'admissions.create', 'admissions.edit', 'admissions.delete',
         'admissions.approve', 'admissions.export',
         'parents.view', 'parents.create', 'parents.edit', 'parents.delete',
         'staff.view', 'staff.create', 'staff.edit', 'staff.delete', 'staff.export',
         'classes.view', 'classes.manage',
         'subjects.view', 'subjects.manage',
         'timetable.view', 'timetable.manage',
         'attendance.view', 'attendance.create', 'attendance.edit', 'attendance.export',
         'exams.view', 'exams.create', 'exams.edit', 'exams.approve', 'exams.export',
         'fees.view', 'fees.create', 'fees.edit', 'fees.approve', 'fees.export',
         'library.view', 'library.manage',
         'transport.view', 'transport.manage',
         'communication.view', 'communication.create', 'communication.approve',
         'reports.view', 'reports.export',
         'settings.view', 'settings.manage',
         'iam.view', 'iam.manage']),
      ('ACCOUNTANT', 'Accountant',
       'Manages fees and reads financial reports.',
       true, ARRAY[
         'dashboard.view', 'students.view', 'parents.view',
         'fees.view', 'fees.create', 'fees.edit', 'fees.approve', 'fees.export',
         'reports.view', 'reports.export']),
      ('TEACHER', 'Teacher',
       'Takes attendance, enters marks and messages classes.',
       false, ARRAY[
         'dashboard.view', 'students.view', 'classes.view', 'subjects.view', 'timetable.view',
         'attendance.view', 'attendance.create', 'attendance.edit',
         'exams.view', 'exams.create', 'exams.edit',
         'communication.view', 'communication.create']),
      ('CLASS_TEACHER', 'Class Teacher',
       'Does what a teacher does, and also looks after one class.',
       false, ARRAY[
         'dashboard.view', 'students.view', 'classes.view', 'subjects.view', 'timetable.view',
         'attendance.view', 'attendance.create', 'attendance.edit',
         'exams.view', 'exams.create', 'exams.edit',
         'communication.view', 'communication.create',
         'students.edit', 'attendance.export', 'exams.approve', 'parents.view']),
      ('LIBRARIAN', 'Librarian',
       'Looks after the library.',
       false, ARRAY[
         'dashboard.view', 'students.view', 'staff.view', 'library.view', 'library.manage']),
      ('RECEPTIONIST', 'Receptionist',
       'Handles admission enquiries and front desk work.',
       false, ARRAY[
         'dashboard.view', 'admissions.view', 'admissions.create', 'admissions.edit',
         'students.view', 'parents.view', 'parents.create', 'communication.view']),
      ('TRANSPORT_MANAGER', 'Transport Manager',
       'Manages buses and routes.',
       false, ARRAY[
         'dashboard.view', 'students.view', 'transport.view', 'transport.manage'])
  ),
  inserted AS (
    INSERT INTO public.roles (id, tenant_id, key, name, description, requires_two_factor)
    SELECT gen_random_uuid(), p_tenant_id, d.key, d.name, d.description, d.requires_two_factor
      FROM defaults AS d
    RETURNING id, key
  )
  INSERT INTO public.role_permissions (role_id, tenant_id, permission)
  SELECT i.id, p_tenant_id, p.permission
    FROM inserted AS i
    JOIN defaults AS d ON d.key = i.key
   CROSS JOIN LATERAL unnest(d.permissions) AS p(permission);
$$;

REVOKE ALL ON FUNCTION seed_builtin_roles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seed_builtin_roles(uuid) TO classloom_app;

-- ---------------------------------------------------------------------------------------------
-- 6. invitation_by_token(hash): spec section 8, "Lookup before a tenant context".
-- ---------------------------------------------------------------------------------------------
-- Accepting or previewing reads an invitation by its token before any school is known, and
-- invitations are under forced row-level security. As with user_schools, this is SECURITY DEFINER
-- (owner has BYPASSRLS) with a pinned search_path and row_security off, so a misconfigured owner
-- fails loudly. It discloses only (id, tenant_id); the rest of the read runs under withTenant.
-- Whether the invitation is still open is decided there, not here.
CREATE FUNCTION invitation_by_token(p_token_hash bytea)
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT i.id, i.tenant_id
    FROM public.invitations AS i
   WHERE i.token_hash = p_token_hash;
$$;

REVOKE ALL ON FUNCTION invitation_by_token(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invitation_by_token(bytea) TO classloom_app;

-- ---------------------------------------------------------------------------------------------
-- 7. Data: every existing school gets the built-in roles, and every membership (all of them are
--    OWNER today) gets the Owner role. Runs as the owner role, which bypasses row-level security.
-- ---------------------------------------------------------------------------------------------
SELECT seed_builtin_roles(t.id) FROM "tenants" AS t;

INSERT INTO "membership_roles" ("membership_id", "role_id", "tenant_id", "assigned_at", "assigned_by")
SELECT m."id", r."id", m."tenant_id", m."created_at", NULL
  FROM "memberships" AS m
  JOIN "roles" AS r ON r."tenant_id" = m."tenant_id" AND r."key" = 'OWNER'
 WHERE m."role" = 'OWNER';

-- Refuse to drop the old column if any membership would lose its access: a school without its
-- built-in roles, or an OWNER membership without the Owner role, aborts the whole migration.
DO $$
DECLARE
  unseeded integer;
  unmoved integer;
BEGIN
  SELECT count(*) INTO unseeded
    FROM "tenants" AS t
   WHERE (SELECT count(*) FROM "roles" AS r WHERE r."tenant_id" = t."id" AND r."key" IS NOT NULL) <> 9;
  SELECT count(*) INTO unmoved
    FROM "memberships" AS m
   WHERE NOT EXISTS (
     SELECT 1 FROM "membership_roles" AS mr
       JOIN "roles" AS r ON r."id" = mr."role_id"
      WHERE mr."membership_id" = m."id" AND r."key" = 'OWNER');
  IF unseeded > 0 OR unmoved > 0 THEN
    RAISE EXCEPTION 'IAM migration: % school(s) without built-in roles, % membership(s) without the Owner role',
      unseeded, unmoved;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 8. Only now drop the old role column and its enum.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "memberships" DROP COLUMN "role";
DROP TYPE "MembershipRole";
