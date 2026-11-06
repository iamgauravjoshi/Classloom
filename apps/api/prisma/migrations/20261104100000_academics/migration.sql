-- Academic structure (Part 5). Spec: docs/superpowers/specs/2026-11-04-academics-design.md,
-- sections 4 and 9. Written by hand in the shape `prisma migrate diff` produces for
-- prisma/schema/academics.prisma, plus what Prisma cannot express: CHECK constraints for every
-- field rule, the lower() and partial unique indexes, the NULLS NOT DISTINCT class-subject key,
-- composite foreign keys (including the room's same-campus key), row-level security, and the
-- widened audit CHECKs. No data is backfilled: each school builds its own structure.

-- ---------------------------------------------------------------------------------------------
-- 1. Enums. Values match @classloom/contracts (src/core/tenancy/academics-enums.test.ts).
-- ---------------------------------------------------------------------------------------------
CREATE TYPE "SubjectType" AS ENUM ('SCHOLASTIC', 'CO_SCHOLASTIC');
CREATE TYPE "RoomType" AS ENUM ('CLASSROOM', 'LAB', 'COMPUTER_LAB', 'LIBRARY', 'HALL', 'OTHER');
CREATE TYPE "HouseColour" AS ENUM (
  'RED', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'PURPLE', 'PINK', 'TEAL', 'BROWN', 'GREY');
CREATE TYPE "AcademicStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "ClassSubjectKind" AS ENUM ('COMPULSORY', 'OPTIONAL');

-- ---------------------------------------------------------------------------------------------
-- 2. Tables. The rules match @classloom/contracts; the API validates first, these are the
--    backstop.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "streams" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AcademicStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "streams_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "streams_name_check" CHECK (char_length("name") BETWEEN 2 AND 40)
);

CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" "SubjectType" NOT NULL,
    "status" "AcademicStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subjects_name_check" CHECK (char_length("name") BETWEEN 2 AND 60),
    -- A label, not unique: boards reuse codes across levels.
    CONSTRAINT "subjects_code_check" CHECK ("code" ~ '^[A-Za-z0-9-]{1,10}$')
);

CREATE TABLE "class_subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "class_level" "ClassLevel" NOT NULL,
    "stream_id" UUID,
    "subject_id" UUID NOT NULL,
    "kind" "ClassSubjectKind" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "class_subjects_pkey" PRIMARY KEY ("id"),
    -- Only senior classes have streams (SENIOR_CLASSES in contracts).
    CONSTRAINT "class_subjects_stream_check"
      CHECK ("stream_id" IS NULL OR "class_level" IN ('XI', 'XII'))
);

CREATE TABLE "houses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "colour" "HouseColour" NOT NULL,
    "status" "AcademicStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "houses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "houses_name_check" CHECK (char_length("name") BETWEEN 2 AND 40)
);

CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "RoomType" NOT NULL,
    "capacity" SMALLINT NOT NULL,
    "floor" TEXT,
    "status" "AcademicStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rooms_name_check" CHECK (char_length("name") BETWEEN 1 AND 40),
    CONSTRAINT "rooms_capacity_check" CHECK ("capacity" BETWEEN 1 AND 500),
    CONSTRAINT "rooms_floor_check" CHECK (char_length("floor") <= 20)
);

CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "class_level" "ClassLevel" NOT NULL,
    "stream_id" UUID,
    "name" TEXT NOT NULL,
    "capacity" SMALLINT NOT NULL,
    "room_id" UUID,
    "class_teacher_membership_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sections_name_check"
      CHECK (char_length("name") BETWEEN 1 AND 20 AND "name" = btrim("name")),
    CONSTRAINT "sections_capacity_check" CHECK ("capacity" BETWEEN 1 AND 200),
    CONSTRAINT "sections_stream_check"
      CHECK ("stream_id" IS NULL OR "class_level" IN ('XI', 'XII'))
);

-- ---------------------------------------------------------------------------------------------
-- 3. Indexes.
-- ---------------------------------------------------------------------------------------------
CREATE INDEX "streams_tenant_id_idx" ON "streams"("tenant_id");
CREATE UNIQUE INDEX "streams_id_tenant_id_key" ON "streams"("id", "tenant_id");
CREATE INDEX "subjects_tenant_id_idx" ON "subjects"("tenant_id");
CREATE UNIQUE INDEX "subjects_id_tenant_id_key" ON "subjects"("id", "tenant_id");
CREATE INDEX "class_subjects_tenant_id_idx" ON "class_subjects"("tenant_id");
CREATE INDEX "class_subjects_stream_id_idx" ON "class_subjects"("stream_id");
CREATE INDEX "class_subjects_subject_id_idx" ON "class_subjects"("subject_id");
CREATE INDEX "houses_tenant_id_idx" ON "houses"("tenant_id");
CREATE INDEX "rooms_tenant_id_idx" ON "rooms"("tenant_id");
CREATE UNIQUE INDEX "rooms_id_campus_id_tenant_id_key" ON "rooms"("id", "campus_id", "tenant_id");
CREATE INDEX "sections_tenant_id_idx" ON "sections"("tenant_id");
CREATE INDEX "sections_campus_id_idx" ON "sections"("campus_id");
CREATE INDEX "sections_stream_id_idx" ON "sections"("stream_id");
CREATE INDEX "sections_room_id_idx" ON "sections"("room_id");
CREATE INDEX "sections_class_teacher_membership_id_idx" ON "sections"("class_teacher_membership_id");
-- Target of the rooms' and sections' composite campus keys.
CREATE UNIQUE INDEX "campuses_id_tenant_id_key" ON "campuses"("id", "tenant_id");

-- Names are unique per school (rooms: per campus; sections: per year, campus and class),
-- ignoring case.
CREATE UNIQUE INDEX "streams_name_key" ON "streams"("tenant_id", lower("name"));
CREATE UNIQUE INDEX "subjects_name_key" ON "subjects"("tenant_id", lower("name"));
CREATE UNIQUE INDEX "houses_name_key" ON "houses"("tenant_id", lower("name"));
CREATE UNIQUE INDEX "rooms_name_key" ON "rooms"("tenant_id", "campus_id", lower("name"));
CREATE UNIQUE INDEX "sections_name_key"
  ON "sections"("tenant_id", "academic_year_id", "campus_id", "class_level", lower("name"));
-- A teacher is class teacher of at most one section per academic year.
CREATE UNIQUE INDEX "sections_class_teacher_key"
  ON "sections"("tenant_id", "academic_year_id", "class_teacher_membership_id")
  WHERE "class_teacher_membership_id" IS NOT NULL;
-- A subject appears once per class and stream; a null stream ("every stream", or a junior class)
-- counts as its own value.
CREATE UNIQUE INDEX "class_subjects_key"
  ON "class_subjects"("tenant_id", "class_level", "stream_id", "subject_id") NULLS NOT DISTINCT;

-- ---------------------------------------------------------------------------------------------
-- 4. Foreign keys. Composite keys keep a row inside one school: foreign key checks bypass
--    row-level security, so a single-column key would let a school point at another school's row.
--    "Restrict" is NO ACTION (checked at the end of the statement), as for membership_roles in the
--    IAM migration: an in-use stream, subject or campus cannot be deleted, but deleting a whole
--    school, which cascades to both sides in one statement, still works.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "streams" ADD CONSTRAINT "streams_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "houses" ADD CONSTRAINT "houses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sections" ADD CONSTRAINT "sections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_stream_id_tenant_id_fkey" FOREIGN KEY ("stream_id", "tenant_id") REFERENCES "streams"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_subject_id_tenant_id_fkey" FOREIGN KEY ("subject_id", "tenant_id") REFERENCES "subjects"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_campus_id_tenant_id_fkey" FOREIGN KEY ("campus_id", "tenant_id") REFERENCES "campuses"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "sections" ADD CONSTRAINT "sections_academic_year_id_tenant_id_fkey" FOREIGN KEY ("academic_year_id", "tenant_id") REFERENCES "academic_years"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sections" ADD CONSTRAINT "sections_campus_id_tenant_id_fkey" FOREIGN KEY ("campus_id", "tenant_id") REFERENCES "campuses"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "sections" ADD CONSTRAINT "sections_stream_id_tenant_id_fkey" FOREIGN KEY ("stream_id", "tenant_id") REFERENCES "streams"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;
-- The room must be on the section's own campus. Deleting the room clears only room_id (PG 15+
-- column list). ON UPDATE NO ACTION: moving a room that sections use to another campus fails
-- rather than silently moving the sections with it.
ALTER TABLE "sections" ADD CONSTRAINT "sections_room_id_fkey" FOREIGN KEY ("room_id", "campus_id", "tenant_id") REFERENCES "rooms"("id", "campus_id", "tenant_id") ON DELETE SET NULL ("room_id") ON UPDATE NO ACTION;
-- Deleting the membership clears only the class teacher.
ALTER TABLE "sections" ADD CONSTRAINT "sections_class_teacher_membership_id_fkey" FOREIGN KEY ("class_teacher_membership_id", "tenant_id") REFERENCES "memberships"("id", "tenant_id") ON DELETE SET NULL ("class_teacher_membership_id") ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- 5. Row-level security, as for every tenant table: with no `app.tenant_id` set the app role sees
--    and writes nothing. The owner role bypasses it (BYPASSRLS) for migrations and the CLI.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "streams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "streams" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "streams"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "subjects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subjects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "subjects"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "class_subjects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "class_subjects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "class_subjects"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "houses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "houses" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "houses"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rooms" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "rooms"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "sections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sections" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "sections"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Explicit, so the grants do not depend on how the database's default privileges were set up.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "streams", "subjects", "class_subjects", "houses", "rooms", "sections"
  TO classloom_app;

-- ---------------------------------------------------------------------------------------------
-- 6. Audit: the academics actions and target types (spec section 4, "Audit"), keeping every
--    earlier one. Mirrored by the AuditAction and AuditTargetType unions in
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
  'room.created', 'room.updated', 'room.archived', 'room.restored', 'room.deleted'));
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_target_type_check";
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_target_type_check" CHECK ("target_type" IN (
  'role', 'membership', 'invitation', 'school', 'academic_year', 'campus',
  'section', 'stream', 'subject', 'class_level', 'house', 'room'));
