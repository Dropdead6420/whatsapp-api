-- Customer Health Score (PRD-v2 Sprint 3 foundation)

CREATE TYPE "CustomerHealthTier" AS ENUM ('THRIVING', 'HEALTHY', 'AT_RISK', 'CHURNING');

CREATE TABLE "CustomerHealthScore" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER NOT NULL,
    "tier" "CustomerHealthTier" NOT NULL,
    "factors" JSONB NOT NULL DEFAULT '{}',
    "recommendation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerHealthScore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerHealthScore_tenantId_dayKey_key" ON "CustomerHealthScore"("tenantId", "dayKey");
CREATE INDEX "CustomerHealthScore_tenantId_assessedAt_idx" ON "CustomerHealthScore"("tenantId", "assessedAt" DESC);
CREATE INDEX "CustomerHealthScore_tier_assessedAt_idx" ON "CustomerHealthScore"("tier", "assessedAt" DESC);

ALTER TABLE "CustomerHealthScore"
  ADD CONSTRAINT "CustomerHealthScore_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
