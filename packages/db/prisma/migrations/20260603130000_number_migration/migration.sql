-- WhatsApp number migration state machine (Claude FINAL §10)
--
-- One row per migration attempt; the service enforces a single ACTIVE
-- (non-terminal) attempt per tenant. Per-step timestamps give an
-- auditable trail of eligibility → OTP → release → webhook → templates.

CREATE TYPE "NumberMigrationStatus" AS ENUM (
  'PENDING_ELIGIBILITY',
  'ELIGIBLE',
  'NOT_ELIGIBLE',
  'OTP_REQUESTED',
  'OTP_VERIFIED',
  'MIGRATING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "NumberMigration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "targetWabaId" TEXT,
    "status" "NumberMigrationStatus" NOT NULL DEFAULT 'PENDING_ELIGIBILITY',
    "statusReason" TEXT,
    "eligibilityCheckedAt" TIMESTAMP(3),
    "otpRequestedAt" TIMESTAMP(3),
    "otpVerifiedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "webhookUpdatedAt" TIMESTAMP(3),
    "templatesSyncedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberMigration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NumberMigration_tenantId_status_idx" ON "NumberMigration"("tenantId", "status");
CREATE INDEX "NumberMigration_status_createdAt_idx" ON "NumberMigration"("status", "createdAt");

ALTER TABLE "NumberMigration"
  ADD CONSTRAINT "NumberMigration_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
