-- AI Platform Monitor (PRD-v2 §8, Sprint 2 final engine).
-- SuperAdmin's triage queue. The scheduled scan ingests signals from
-- wallet-risk + compliance + provider-router and upserts on dedupeKey.

CREATE TYPE "PlatformActionStatus" AS ENUM ('OPEN', 'ACKED', 'RESOLVED', 'DISMISSED', 'SNOOZED');
CREATE TYPE "PlatformActionSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "PlatformActionCode" AS ENUM (
  'WALLET_RISK_CRITICAL',
  'WALLET_RISK_URGENT',
  'COMPLIANCE_BLOCK_SPIKE',
  'PROVIDER_HEALTH_DEGRADED',
  'WEBHOOK_FAILURE_SPIKE',
  'AI_USAGE_SPIKE',
  'CHURN_RISK',
  'ONBOARDING_STALLED'
);

CREATE TABLE "PlatformActionItem" (
    "id" TEXT NOT NULL,
    "code" "PlatformActionCode" NOT NULL,
    "severity" "PlatformActionSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "targetTenantId" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "status" "PlatformActionStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformActionItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformActionItem_dedupeKey_key" ON "PlatformActionItem"("dedupeKey");
CREATE INDEX "PlatformActionItem_status_severity_createdAt_idx" ON "PlatformActionItem"("status", "severity", "createdAt");
CREATE INDEX "PlatformActionItem_targetTenantId_status_idx" ON "PlatformActionItem"("targetTenantId", "status");
CREATE INDEX "PlatformActionItem_code_createdAt_idx" ON "PlatformActionItem"("code", "createdAt");

ALTER TABLE "PlatformActionItem" ADD CONSTRAINT "PlatformActionItem_targetTenantId_fkey" FOREIGN KEY ("targetTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
