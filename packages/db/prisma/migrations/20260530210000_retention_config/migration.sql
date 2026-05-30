-- Retention autopilot config (PRD-v2 Sprint 4 slice 2)

CREATE TYPE "RetentionMode" AS ENUM ('MANUAL', 'ASSISTED', 'AUTOPILOT');

CREATE TABLE "RetentionConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mode" "RetentionMode" NOT NULL DEFAULT 'MANUAL',
    "winbackSequenceId" TEXT,
    "maxEnrollPerRun" INTEGER NOT NULL DEFAULT 50,
    "lastRunAt" TIMESTAMP(3),
    "lastEnrolledCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RetentionConfig_tenantId_key" ON "RetentionConfig"("tenantId");
CREATE INDEX "RetentionConfig_mode_idx" ON "RetentionConfig"("mode");

ALTER TABLE "RetentionConfig"
  ADD CONSTRAINT "RetentionConfig_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RetentionConfig"
  ADD CONSTRAINT "RetentionConfig_winbackSequenceId_fkey"
  FOREIGN KEY ("winbackSequenceId") REFERENCES "DripSequence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
