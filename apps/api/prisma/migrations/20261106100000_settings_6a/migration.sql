-- Number series and the audit permission (Part 6a). Spec:
-- docs/superpowers/specs/2026-11-06-settings-6a-design.md, sections 3, 4 and 8. Written by hand in
-- the shape `prisma migrate diff` produces for prisma/schema/settings.prisma, plus what Prisma
-- cannot express: CHECK constraints, row-level security, the default series for every existing
-- school, the `audit.view` grant for the built-in Admin role (existing schools and, through
-- seed_builtin_roles, new ones) and the widened audit CHECKs.

-- ---------------------------------------------------------------------------------------------
-- 1. Enums. Values match @classloom/contracts (src/core/tenancy/settings-enums.test.ts).
-- ---------------------------------------------------------------------------------------------
CREATE TYPE "NumberSeriesKey" AS ENUM ('ENQUIRY', 'APPLICATION', 'ADMISSION', 'FEE_RECEIPT');
CREATE TYPE "NumberSeriesReset" AS ENUM ('ACADEMIC_YEAR', 'NEVER');

-- ---------------------------------------------------------------------------------------------
-- 2. Tables. The service validates the full pattern rules first; these are the backstop.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "number_series" (
    "tenant_id" UUID NOT NULL,
    "key" "NumberSeriesKey" NOT NULL,
    "pattern" TEXT NOT NULL,
    "reset" "NumberSeriesReset" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "number_series_pkey" PRIMARY KEY ("tenant_id", "key"),
    CONSTRAINT "number_series_pattern_check" CHECK (char_length("pattern") BETWEEN 1 AND 40)
);

CREATE TABLE "number_series_counters" (
    "tenant_id" UUID NOT NULL,
    "key" "NumberSeriesKey" NOT NULL,
    "period" TEXT NOT NULL,
    "last_value" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "number_series_counters_pkey" PRIMARY KEY ("tenant_id", "key", "period"),
    CONSTRAINT "number_series_counters_last_value_check" CHECK ("last_value" >= 0),
    -- An academic year id as text (ACADEMIC_YEAR), or 'ALL' (NEVER).
    CONSTRAINT "number_series_counters_period_check"
      CHECK ("period" = 'ALL' OR "period" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);

-- ---------------------------------------------------------------------------------------------
-- 3. Foreign keys. A counter's key includes tenant_id, so it can only belong to its own school's
--    series; deleting the series or the school removes its counters.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "number_series_counters" ADD CONSTRAINT "number_series_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "number_series_counters" ADD CONSTRAINT "number_series_counters_tenant_id_key_fkey" FOREIGN KEY ("tenant_id", "key") REFERENCES "number_series"("tenant_id", "key") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- 4. Row-level security, as for every tenant table: with no `app.tenant_id` set the app role sees
--    and writes nothing. The owner role bypasses it (BYPASSRLS) for migrations and the CLI.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "number_series" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "number_series" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "number_series"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "number_series_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "number_series_counters" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "number_series_counters"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Explicit, so the grants do not depend on how the database's default privileges were set up.
GRANT SELECT, INSERT, UPDATE, DELETE ON "number_series", "number_series_counters" TO classloom_app;

-- ---------------------------------------------------------------------------------------------
-- 5. Data: the four default series for every existing school (DEFAULT_SERIES in
--    @classloom/contracts; registration seeds new schools from the same constant). Counters start
--    empty: the first number issued creates its period's row. Runs as the owner role.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "number_series" ("tenant_id", "key", "pattern", "reset")
SELECT t."id", d."key"::"NumberSeriesKey", d."pattern", d."reset"::"NumberSeriesReset"
  FROM "tenants" AS t
 CROSS JOIN (VALUES
   ('ENQUIRY', 'ENQ/{AY}/{SEQ:4}', 'ACADEMIC_YEAR'),
   ('APPLICATION', 'APP/{AY}/{SEQ:4}', 'ACADEMIC_YEAR'),
   ('ADMISSION', '{SEQ:5}', 'NEVER'),
   ('FEE_RECEIPT', 'REC/{AY}/{SEQ:5}', 'ACADEMIC_YEAR')
 ) AS d ("key", "pattern", "reset");

-- ---------------------------------------------------------------------------------------------
-- 6. The audit permission (spec section 4). The built-in Admin role has every permission, so it
--    gains `audit.view`; Principal's defaults exclude it, and Owner means all (no rows).
-- ---------------------------------------------------------------------------------------------
-- Existing schools. Idempotent, so a school whose Admin already has it is left alone.
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission")
SELECT r."id", r."tenant_id", 'audit.view'
  FROM "roles" AS r
 WHERE r."key" = 'ADMIN'
ON CONFLICT DO NOTHING;

-- New schools: seed_builtin_roles (IAM migration, section 5) as before, with `audit.view` added to
-- Admin. Must match BUILT_IN_ROLE_DEFAULTS in @classloom/contracts (checked by
-- test/iam/schema.int.test.ts and test/tenancy/registration.int.test.ts). CREATE OR REPLACE keeps
-- the function's owner and grants.
CREATE OR REPLACE FUNCTION seed_builtin_roles(p_tenant_id uuid)
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
         'iam.view', 'iam.manage',
         'audit.view']),
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

-- ---------------------------------------------------------------------------------------------
-- 7. Audit: the Part 6a actions and target types (spec sections 3, 5 and 8), keeping every earlier
--    one. Mirrored by the AuditAction and AuditTargetType unions in
--    src/modules/iam/audit.service.ts.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_check";
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_check" CHECK ("action" IN (
  'role.created', 'role.updated', 'role.deleted', 'role.permissions_changed',
  'member.invited', 'member.invite_revoked', 'member.joined', 'member.roles_changed',
  'member.deactivated', 'member.reactivated', 'member.two_factor_reset',
  'school.profile_updated', 'school.logo_changed', 'school.logo_removed',
  'academic_year.created', 'academic_year.updated', 'academic_year.made_current',
  'academic_year.deleted',
  'campus.created', 'campus.updated', 'campus.deactivated', 'campus.reactivated',
  'campus.made_primary',
  'section.created', 'section.updated', 'section.deleted', 'sections.copied',
  'stream.created', 'stream.updated', 'stream.archived', 'stream.restored', 'stream.deleted',
  'subject.created', 'subject.updated', 'subject.archived', 'subject.restored',
  'subject.deleted', 'subjects.starter_added',
  'class_subjects.updated',
  'house.created', 'house.updated', 'house.archived', 'house.restored', 'house.deleted',
  'room.created', 'room.updated', 'room.archived', 'room.restored', 'room.deleted',
  'number_series.updated',
  'audit.exported'));
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_target_type_check";
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_target_type_check" CHECK ("target_type" IN (
  'role', 'membership', 'invitation', 'school', 'academic_year', 'campus',
  'section', 'stream', 'subject', 'class_level', 'house', 'room',
  'number_series', 'audit'));
