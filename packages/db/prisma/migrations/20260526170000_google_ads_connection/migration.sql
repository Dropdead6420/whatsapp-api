-- Google Ads API connection (PRD §3.3.7, Phase 4).
-- Mirrors the MetaAdsConnection shape: one row per tenant, encrypted
-- refresh token, cached account metadata.

CREATE TABLE "GoogleAdsConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "loginCustomerId" TEXT,
    "customerName" TEXT,
    "currency" TEXT,
    "timeZoneName" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAdsConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleAdsConnection_tenantId_key" ON "GoogleAdsConnection"("tenantId");

ALTER TABLE "GoogleAdsConnection" ADD CONSTRAINT "GoogleAdsConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
