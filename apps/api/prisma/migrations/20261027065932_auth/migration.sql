-- CreateEnum
CREATE TYPE "SessionRevokedReason" AS ENUM ('SIGNED_OUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'REPLACED');

-- CreateEnum
CREATE TYPE "AuthEventType" AS ENUM ('SIGN_IN_SUCCEEDED', 'SIGN_IN_FAILED', 'SIGN_IN_PAUSED', 'CODE_REQUESTED', 'PASSWORD_SET', 'PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET', 'SIGNED_OUT');

-- CreateEnum
CREATE TYPE "AuthMethod" AS ENUM ('PASSWORD', 'EMAIL_CODE', 'RESET_LINK');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_changed_at" TIMESTAMPTZ(6),
ADD COLUMN     "password_hash" TEXT;

-- Mobile numbers become unique so mobile sign-in is never ambiguous. Added by hand (Prisma cannot
-- express a partial unique index). Where several users share a number, only the oldest keeps it;
-- there is no production data yet, so this only protects local databases.
-- dedupe:start
UPDATE "users"
SET "mobile" = NULL
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT "id", row_number() OVER (PARTITION BY "mobile" ORDER BY "created_at", "id") AS "rank"
    FROM "users"
    WHERE "mobile" IS NOT NULL
  ) AS "ranked"
  WHERE "rank" > 1
);
-- dedupe:end

CREATE UNIQUE INDEX "users_mobile_key" ON "users"("mobile") WHERE "mobile" IS NOT NULL;

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "remember" BOOLEAN NOT NULL,
    "authenticated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ip" INET,
    "user_agent" TEXT,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" "SessionRevokedReason",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_events" (
    "id" UUID NOT NULL,
    "type" "AuthEventType" NOT NULL,
    "method" "AuthMethod",
    "user_id" UUID,
    "tenant_id" UUID,
    "session_id" UUID,
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_tenant_id_idx" ON "sessions"("tenant_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "auth_events_user_id_created_at_idx" ON "auth_events"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
