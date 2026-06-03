-- Corrected billing rate engine foundation.
--
-- Implements the final billing PDF's first slice:
--   - WhatsAppRateTable: real country/category/provider costs
--   - PartnerRateRule: partner/customer markup overlays
--   - UsageEvent: idempotent usage quote/debit ledger
--
-- Money fields ending in `Micros` are 1/1,000,000 of the row currency.

CREATE TYPE "WhatsAppUsageCategory" AS ENUM (
  'MARKETING',
  'UTILITY',
  'AUTHENTICATION',
  'SERVICE'
);

CREATE TYPE "UsageEventKind" AS ENUM (
  'WHATSAPP_MESSAGE',
  'AI_CALL'
);

CREATE TYPE "UsageEventStatus" AS ENUM (
  'QUOTED',
  'AUTHORIZED',
  'DEBITED',
  'BLOCKED',
  'FAILED'
);

CREATE TABLE "WhatsAppRateTable" (
  "id" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL,
  "category" "WhatsAppUsageCategory" NOT NULL,
  "providerKey" "WhatsAppProviderKey" NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "baseCostMicros" BIGINT NOT NULL,
  "providerCostMicros" BIGINT NOT NULL DEFAULT 0,
  "taxBps" INTEGER NOT NULL DEFAULT 0,
  "gatewayFeeBps" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WhatsAppRateTable_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsAppRateTable_countryCode_category_providerKey_isActive_effectiveFrom_idx"
  ON "WhatsAppRateTable"("countryCode", "category", "providerKey", "isActive", "effectiveFrom");

CREATE INDEX "WhatsAppRateTable_providerKey_isActive_idx"
  ON "WhatsAppRateTable"("providerKey", "isActive");

CREATE TABLE "PartnerRateRule" (
  "id" TEXT NOT NULL,
  "partnerTenantId" TEXT NOT NULL,
  "customerTenantId" TEXT,
  "countryCode" TEXT,
  "category" "WhatsAppUsageCategory",
  "providerKey" "WhatsAppProviderKey",
  "markupBps" INTEGER NOT NULL DEFAULT 0,
  "fixedMarkupMicros" BIGINT NOT NULL DEFAULT 0,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PartnerRateRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnerRateRule_partnerTenantId_isActive_priority_idx"
  ON "PartnerRateRule"("partnerTenantId", "isActive", "priority");

CREATE INDEX "PartnerRateRule_customerTenantId_isActive_idx"
  ON "PartnerRateRule"("customerTenantId", "isActive");

CREATE INDEX "PartnerRateRule_countryCode_category_providerKey_idx"
  ON "PartnerRateRule"("countryCode", "category", "providerKey");

CREATE TABLE "UsageEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "partnerTenantId" TEXT,
  "kind" "UsageEventKind" NOT NULL,
  "status" "UsageEventStatus" NOT NULL DEFAULT 'QUOTED',
  "idempotencyKey" TEXT NOT NULL,
  "providerKey" "WhatsAppProviderKey",
  "countryCode" TEXT,
  "category" "WhatsAppUsageCategory",
  "units" INTEGER NOT NULL DEFAULT 1,
  "source" TEXT,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "contentHash" TEXT,
  "rateTableId" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "baseCostMicros" BIGINT NOT NULL DEFAULT 0,
  "providerCostMicros" BIGINT NOT NULL DEFAULT 0,
  "partnerMarkupBps" INTEGER NOT NULL DEFAULT 0,
  "partnerMarkupMicros" BIGINT NOT NULL DEFAULT 0,
  "taxBps" INTEGER NOT NULL DEFAULT 0,
  "gatewayFeeBps" INTEGER NOT NULL DEFAULT 0,
  "subtotalMicros" BIGINT NOT NULL DEFAULT 0,
  "taxMicros" BIGINT NOT NULL DEFAULT 0,
  "gatewayFeeMicros" BIGINT NOT NULL DEFAULT 0,
  "totalCostMicros" BIGINT NOT NULL DEFAULT 0,
  "walletCurrency" TEXT NOT NULL DEFAULT 'INR',
  "currencyRateMicros" BIGINT NOT NULL DEFAULT 1000000,
  "walletCostMicros" BIGINT NOT NULL DEFAULT 0,
  "walletDebitCredits" INTEGER NOT NULL DEFAULT 0,
  "aiFeature" TEXT,
  "metadata" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsageEvent_tenantId_idempotencyKey_key"
  ON "UsageEvent"("tenantId", "idempotencyKey");

CREATE INDEX "UsageEvent_tenantId_kind_createdAt_idx"
  ON "UsageEvent"("tenantId", "kind", "createdAt");

CREATE INDEX "UsageEvent_status_createdAt_idx"
  ON "UsageEvent"("status", "createdAt");

CREATE INDEX "UsageEvent_referenceType_referenceId_idx"
  ON "UsageEvent"("referenceType", "referenceId");

CREATE INDEX "UsageEvent_partnerTenantId_createdAt_idx"
  ON "UsageEvent"("partnerTenantId", "createdAt");

ALTER TABLE "UsageEvent"
  ADD CONSTRAINT "UsageEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
