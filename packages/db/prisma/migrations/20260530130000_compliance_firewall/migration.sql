-- Compliance Firewall: tenant-scoped pre-send safety checks.

CREATE TYPE "ComplianceScope" AS ENUM ('CAMPAIGN', 'DRIP_STEP', 'TEMPLATE', 'REPLY');
CREATE TYPE "ComplianceVerdict" AS ENUM ('PASS', 'REVIEW', 'BLOCK');
CREATE TYPE "ComplianceMode" AS ENUM ('MANUAL', 'ASSISTED', 'AUTOPILOT');

ALTER TABLE "Tenant"
  ADD COLUMN "complianceMode" JSONB;

CREATE TABLE "ComplianceCheck" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "scope" "ComplianceScope" NOT NULL,
  "refId" TEXT,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "verdict" "ComplianceVerdict" NOT NULL,
  "score" INTEGER NOT NULL,
  "violations" JSONB NOT NULL DEFAULT '[]',
  "rewrite" TEXT,
  "reasoning" TEXT,
  "mode" "ComplianceMode" NOT NULL DEFAULT 'ASSISTED',
  "overridden" BOOLEAN NOT NULL DEFAULT false,
  "overriddenReason" TEXT,
  "overriddenByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,

  CONSTRAINT "ComplianceCheck_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ComplianceCheck"
  ADD CONSTRAINT "ComplianceCheck_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ComplianceCheck_tenantId_scope_createdAt_idx"
  ON "ComplianceCheck"("tenantId", "scope", "createdAt");

CREATE INDEX "ComplianceCheck_tenantId_verdict_idx"
  ON "ComplianceCheck"("tenantId", "verdict");

CREATE INDEX "ComplianceCheck_tenantId_contentHash_idx"
  ON "ComplianceCheck"("tenantId", "contentHash");
