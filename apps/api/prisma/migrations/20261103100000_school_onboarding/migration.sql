-- School onboarding (Part 4). Spec: docs/superpowers/specs/2026-11-03-onboarding-design.md,
-- sections 4 and 12. Written by hand in the shape `prisma migrate diff` produces for
-- prisma/schema/school.prisma and the new campus columns, plus what Prisma cannot express: CHECK
-- constraints for every field rule, the btree_gist exclusion constraint, the partial and
-- lower() unique indexes, composite foreign keys, row-level security, the widened audit CHECKs,
-- and the guarded backfill of one profile per school.

-- ---------------------------------------------------------------------------------------------
-- 1. Extension and enums.
-- ---------------------------------------------------------------------------------------------
-- btree_gist lets the exclusion constraint compare tenant_id (a plain uuid) with `=` in a GiST
-- index. It is a trusted extension, so the owner role can create it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Order matters for ClassLevel: `lowest_class <= highest_class` compares by declaration order.
CREATE TYPE "ClassLevel" AS ENUM (
  'NURSERY', 'LKG', 'UKG', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII');
CREATE TYPE "SchoolType" AS ENUM ('CO_ED', 'BOYS', 'GIRLS');
CREATE TYPE "Residential" AS ENUM ('DAY', 'BOARDING', 'DAY_AND_BOARDING');
CREATE TYPE "AcademicYearStatus" AS ENUM ('PLANNED', 'CURRENT', 'CLOSED');
CREATE TYPE "FilePurpose" AS ENUM ('SCHOOL_LOGO');

-- ---------------------------------------------------------------------------------------------
-- 2. Tables. The profile and campus rules match @classloom/contracts and @classloom/utils (UDISE+,
--    PIN, affiliation number, E.164 Indian phone); the API validates first, these are the backstop.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purpose" "FilePurpose" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" BYTEA NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "files_storage_key_check" CHECK (char_length("storage_key") BETWEEN 1 AND 300),
    CONSTRAINT "files_content_type_check" CHECK (char_length("content_type") BETWEEN 1 AND 100),
    CONSTRAINT "files_byte_size_check" CHECK ("byte_size" > 0),
    CONSTRAINT "files_dimensions_check" CHECK ("width" > 0 AND "height" > 0),
    CONSTRAINT "files_sha256_check" CHECK (octet_length("sha256") = 32)
);

CREATE TABLE "school_profiles" (
    "tenant_id" UUID NOT NULL,
    "legal_name" TEXT,
    "short_name" TEXT,
    "established_year" SMALLINT,
    "udise_code" CHAR(11),
    "affiliation_number" TEXT,
    "school_type" "SchoolType",
    "residential" "Residential",
    "medium" TEXT,
    "lowest_class" "ClassLevel",
    "highest_class" "ClassLevel",
    "phone" TEXT,
    "email" CITEXT,
    "website" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "district" TEXT,
    "state" "IndianState" NOT NULL,
    "pin_code" CHAR(6),
    "logo_file_id" UUID,
    "onboarding_started_at" TIMESTAMPTZ(6),
    "onboarding_dismissed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_profiles_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "school_profiles_legal_name_check" CHECK (char_length("legal_name") <= 150),
    CONSTRAINT "school_profiles_short_name_check" CHECK (char_length("short_name") <= 12),
    -- The upper bound (the current year) moves, so the API checks it; a CHECK must be immutable.
    CONSTRAINT "school_profiles_established_year_check" CHECK ("established_year" >= 1800),
    CONSTRAINT "school_profiles_udise_code_check"
      CHECK ("udise_code" ~ '^(0[1-9]|[12][0-9]|3[0-8])[0-9]{9}$'),
    CONSTRAINT "school_profiles_affiliation_number_check"
      CHECK ("affiliation_number" ~ '^[A-Za-z0-9/-]{1,30}$'),
    CONSTRAINT "school_profiles_medium_check" CHECK (char_length("medium") <= 40),
    CONSTRAINT "school_profiles_class_range_check" CHECK ("lowest_class" <= "highest_class"),
    CONSTRAINT "school_profiles_phone_check" CHECK ("phone" ~ '^\+91[1-9][0-9]{9}$'),
    CONSTRAINT "school_profiles_email_check" CHECK (char_length("email") <= 254),
    CONSTRAINT "school_profiles_website_check"
      CHECK ("website" ~ '^https://' AND char_length("website") <= 200),
    CONSTRAINT "school_profiles_address_line1_check" CHECK (char_length("address_line1") <= 120),
    CONSTRAINT "school_profiles_address_line2_check" CHECK (char_length("address_line2") <= 120),
    CONSTRAINT "school_profiles_city_check" CHECK (char_length("city") <= 60),
    CONSTRAINT "school_profiles_district_check" CHECK (char_length("district") <= 60),
    CONSTRAINT "school_profiles_pin_code_check" CHECK ("pin_code" ~ '^[1-9][0-9]{5}$')
);

CREATE TABLE "academic_years" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "status" "AcademicYearStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "academic_years_label_check" CHECK (char_length("label") BETWEEN 1 AND 20),
    -- Date subtraction gives whole days: the same 180-400 rule as yearLengthOk in contracts.
    -- (It also implies ends_on > starts_on.)
    CONSTRAINT "academic_years_length_check" CHECK (("ends_on" - "starts_on") BETWEEN 180 AND 400),
    -- No two years of a school overlap, end dates included.
    CONSTRAINT "academic_years_no_overlap" EXCLUDE USING gist (
      "tenant_id" WITH =,
      daterange("starts_on", "ends_on", '[]') WITH &&
    )
);

CREATE TABLE "academic_terms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "seq" SMALLINT NOT NULL,
    "name" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "academic_terms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "academic_terms_seq_check" CHECK ("seq" BETWEEN 1 AND 3),
    CONSTRAINT "academic_terms_name_check" CHECK (char_length("name") BETWEEN 1 AND 40),
    CONSTRAINT "academic_terms_dates_check" CHECK ("ends_on" >= "starts_on")
);

-- New campus columns: optional, with the profile's rules.
ALTER TABLE "campuses"
  ADD COLUMN "address_line1" TEXT,
  ADD COLUMN "address_line2" TEXT,
  ADD COLUMN "district" TEXT,
  ADD COLUMN "pin_code" CHAR(6),
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "email" CITEXT,
  ADD CONSTRAINT "campuses_address_line1_check" CHECK (char_length("address_line1") <= 120),
  ADD CONSTRAINT "campuses_address_line2_check" CHECK (char_length("address_line2") <= 120),
  ADD CONSTRAINT "campuses_district_check" CHECK (char_length("district") <= 60),
  ADD CONSTRAINT "campuses_pin_code_check" CHECK ("pin_code" ~ '^[1-9][0-9]{5}$'),
  ADD CONSTRAINT "campuses_phone_check" CHECK ("phone" ~ '^\+91[1-9][0-9]{9}$'),
  ADD CONSTRAINT "campuses_email_check" CHECK (char_length("email") <= 254);

-- ---------------------------------------------------------------------------------------------
-- 3. Indexes and foreign keys.
-- ---------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX "files_id_tenant_id_key" ON "files"("id", "tenant_id");
CREATE INDEX "files_tenant_id_idx" ON "files"("tenant_id");
CREATE INDEX "school_profiles_logo_file_id_idx" ON "school_profiles"("logo_file_id");
CREATE UNIQUE INDEX "academic_years_id_tenant_id_key" ON "academic_years"("id", "tenant_id");
CREATE INDEX "academic_years_tenant_id_idx" ON "academic_years"("tenant_id");
CREATE UNIQUE INDEX "academic_terms_academic_year_id_seq_key" ON "academic_terms"("academic_year_id", "seq");
CREATE INDEX "academic_terms_tenant_id_idx" ON "academic_terms"("tenant_id");

-- At most one CURRENT and one PLANNED year per school (only the next year can be prepared).
CREATE UNIQUE INDEX "academic_years_one_current" ON "academic_years"("tenant_id") WHERE "status" = 'CURRENT';
CREATE UNIQUE INDEX "academic_years_one_planned" ON "academic_years"("tenant_id") WHERE "status" = 'PLANNED';
-- Labels and campus names are unique per school, ignoring case. (`campuses_one_primary`, one
-- primary campus per school, already exists from the tenancy migration.)
CREATE UNIQUE INDEX "academic_years_label_key" ON "academic_years"("tenant_id", lower("label"));
CREATE UNIQUE INDEX "campuses_name_key" ON "campuses"("tenant_id", lower("name"));

ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "school_profiles" ADD CONSTRAINT "school_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Composite keys keep a row inside one school: foreign key checks bypass row-level security, so a
-- single-column key would let a school point at another school's file or year (as in the IAM
-- migration). The logo key nulls only logo_file_id when the file goes (tenant_id is the PK).
ALTER TABLE "school_profiles" ADD CONSTRAINT "school_profiles_logo_file_id_fkey" FOREIGN KEY ("logo_file_id", "tenant_id") REFERENCES "files"("id", "tenant_id") ON DELETE SET NULL ("logo_file_id") ON UPDATE CASCADE;
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_academic_year_id_tenant_id_fkey" FOREIGN KEY ("academic_year_id", "tenant_id") REFERENCES "academic_years"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- 4. Row-level security, as for every tenant table: with no `app.tenant_id` set the app role sees
--    and writes nothing. The owner role bypasses it (BYPASSRLS) for migrations and the CLI. The
--    app role's SELECT/INSERT/UPDATE/DELETE grants come from the default privileges (01-roles.sql).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "school_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "school_profiles"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "files"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "academic_years" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "academic_years" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "academic_years"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "academic_terms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "academic_terms" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "academic_terms"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Explicit, so the grants do not depend on how the database's default privileges were set up.
GRANT SELECT, INSERT, UPDATE, DELETE ON "school_profiles", "files", "academic_years", "academic_terms"
  TO classloom_app;

-- ---------------------------------------------------------------------------------------------
-- 5. Audit: the onboarding actions and target types (spec section 4, "Audit"). Mirrored by the
--    AuditAction and AuditTargetType unions in src/modules/iam/audit.service.ts.
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
  'campus.made_primary'));
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_target_type_check";
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_target_type_check" CHECK ("target_type" IN (
  'role', 'membership', 'invitation', 'school', 'academic_year', 'campus'));

-- ---------------------------------------------------------------------------------------------
-- 6. Guard, then data. Every school must have exactly one primary campus (Part 1 guarantees it);
--    if any does not, abort the whole migration (rolling it back) rather than build on bad data.
--    Then one profile per school, with city and state copied from tenants. No academic year is
--    created: each school sets up its own in the onboarding wizard. Runs as the owner role, which
--    bypasses row-level security.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  bad integer;
BEGIN
  SELECT count(*) INTO bad
    FROM "tenants" AS t
   WHERE (SELECT count(*) FROM "campuses" AS c WHERE c."tenant_id" = t."id" AND c."is_primary") <> 1;
  IF bad > 0 THEN
    RAISE EXCEPTION 'School onboarding migration: % school(s) without exactly one primary campus', bad;
  END IF;
END
$$;

INSERT INTO "school_profiles" ("tenant_id", "city", "state", "created_at", "updated_at")
SELECT t."id", t."city", t."state", now(), now()
  FROM "tenants" AS t;
