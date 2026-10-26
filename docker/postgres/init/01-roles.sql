-- Creates the two application roles. Idempotent so test infrastructure can re-run it.
--   classloom_owner: owns the database and schema; runs migrations (DATABASE_MIGRATION_URL).
--   classloom_app:   restricted runtime role (DATABASE_URL); no DDL, no BYPASSRLS, so row-level
--                    security policies always apply to it.
-- Development passwords only; production sets its own via secrets.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'classloom_owner') THEN
    CREATE ROLE classloom_owner LOGIN PASSWORD 'classloom_owner';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'classloom_app') THEN
    CREATE ROLE classloom_app LOGIN PASSWORD 'classloom_app' NOSUPERUSER NOBYPASSRLS;
  END IF;

  -- Always applied so volumes created by an earlier version of this script converge.
  -- The owner bypasses RLS (migrations, platform CLI) and needs CREATEDB for Prisma's shadow database.
  ALTER ROLE classloom_owner LOGIN NOSUPERUSER BYPASSRLS CREATEDB;
  ALTER ROLE classloom_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB;

  EXECUTE format('ALTER DATABASE %I OWNER TO classloom_owner', current_database());
  ALTER SCHEMA public OWNER TO classloom_owner;
  GRANT USAGE ON SCHEMA public TO classloom_app;

  ALTER DEFAULT PRIVILEGES FOR ROLE classloom_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO classloom_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE classloom_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO classloom_app;
END
$$;
