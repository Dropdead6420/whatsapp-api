-- AI Wallet Risk Engine (PRD-v2 §8, Sprint 2).
-- One assessment row per (tenantId, dayKey) so the scheduled worker
-- can re-run inside the same UTC day without bloating history.

CREATE TYPE "WalletRiskTier" AS ENUM ('OK', 'WATCH', 'URGENT', 'CRITICAL');
CREATE TYPE "WalletRiskAction" AS ENUM (
  'NONE',
  'RECHARGE',
  'ENABLE_AUTO_RECHARGE',
  'THROTTLE_CAMPAIGNS',
  'SWITCH_TO_POSTPAID',
  'UPGRADE_PLAN'
);

CREATE TABLE "WalletRiskAssessment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balanceCredits" INTEGER NOT NULL,
    "lowBalanceThreshold" INTEGER NOT NULL,
    "dailyBurnAvg" DOUBLE PRECISION NOT NULL,
    "dailyBurnP90" DOUBLE PRECISION NOT NULL,
    "daysToLowBalance" DOUBLE PRECISION,
    "daysToZero" DOUBLE PRECISION,
    "riskTier" "WalletRiskTier" NOT NULL,
    "recommendedActionCode" "WalletRiskAction" NOT NULL DEFAULT 'NONE',
    "recommendedAmountCredits" INTEGER,
    "reasoning" TEXT,
    "llmUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletRiskAssessment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WalletRiskAssessment_tenantId_dayKey_key" ON "WalletRiskAssessment"("tenantId", "dayKey");
CREATE INDEX "WalletRiskAssessment_tenantId_assessedAt_idx" ON "WalletRiskAssessment"("tenantId", "assessedAt" DESC);
CREATE INDEX "WalletRiskAssessment_riskTier_assessedAt_idx" ON "WalletRiskAssessment"("riskTier", "assessedAt" DESC);

ALTER TABLE "WalletRiskAssessment" ADD CONSTRAINT "WalletRiskAssessment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletRiskAssessment" ADD CONSTRAINT "WalletRiskAssessment_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
