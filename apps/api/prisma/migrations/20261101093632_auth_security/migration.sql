-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'TWO_FACTOR_SUCCEEDED';
ALTER TYPE "AuthEventType" ADD VALUE 'TWO_FACTOR_FAILED';
ALTER TYPE "AuthEventType" ADD VALUE 'RECOVERY_CODE_USED';
ALTER TYPE "AuthEventType" ADD VALUE 'TWO_FACTOR_ENABLED';
ALTER TYPE "AuthEventType" ADD VALUE 'TWO_FACTOR_DISABLED';
ALTER TYPE "AuthEventType" ADD VALUE 'RECOVERY_CODES_REGENERATED';
ALTER TYPE "AuthEventType" ADD VALUE 'DEVICE_TRUSTED';
ALTER TYPE "AuthEventType" ADD VALUE 'DEVICE_UNTRUSTED';
ALTER TYPE "AuthEventType" ADD VALUE 'SESSION_REVOKED';

-- AlterEnum
ALTER TYPE "AuthMethod" ADD VALUE 'RECOVERY_CODE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SessionRevokedReason" ADD VALUE 'REVOKED_BY_USER';
ALTER TYPE "SessionRevokedReason" ADD VALUE 'TWO_FACTOR_DISABLED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totp_enabled_at" TIMESTAMPTZ(6),
ADD COLUMN     "totp_last_step" BIGINT,
ADD COLUMN     "totp_secret_enc" BYTEA;

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "known_devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_hash" BYTEA NOT NULL,
    "label" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "trusted_until" TIMESTAMPTZ(6),

    CONSTRAINT "known_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recovery_codes_user_id_code_hash_key" ON "recovery_codes"("user_id", "code_hash");

-- CreateIndex
CREATE INDEX "known_devices_last_seen_at_idx" ON "known_devices"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "known_devices_user_id_device_hash_key" ON "known_devices"("user_id", "device_hash");

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
