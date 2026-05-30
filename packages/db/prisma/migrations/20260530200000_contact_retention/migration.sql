-- AI Retention Engine (PRD-v2 Sprint 4 slice 1)

CREATE TYPE "RetentionTier" AS ENUM ('ACTIVE', 'COOLING', 'DORMANT', 'LOST');

CREATE TABLE "ContactRetentionScore" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER NOT NULL,
    "tier" "RetentionTier" NOT NULL,
    "daysSinceInteraction" INTEGER NOT NULL,
    "factors" JSONB NOT NULL DEFAULT '{}',
    "recommendation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactRetentionScore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactRetentionScore_tenantId_contactId_dayKey_key" ON "ContactRetentionScore"("tenantId", "contactId", "dayKey");
CREATE INDEX "ContactRetentionScore_tenantId_tier_score_idx" ON "ContactRetentionScore"("tenantId", "tier", "score");
CREATE INDEX "ContactRetentionScore_tenantId_assessedAt_idx" ON "ContactRetentionScore"("tenantId", "assessedAt" DESC);
CREATE INDEX "ContactRetentionScore_contactId_assessedAt_idx" ON "ContactRetentionScore"("contactId", "assessedAt" DESC);

ALTER TABLE "ContactRetentionScore"
  ADD CONSTRAINT "ContactRetentionScore_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactRetentionScore"
  ADD CONSTRAINT "ContactRetentionScore_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
