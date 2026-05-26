-- Meta Marketing API connection (PRD §3.3.6, Phase 4).
-- One row per tenant; token is stored encrypted via the WABA token
-- crypto envelope.

CREATE TABLE "MetaAdsConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "adAccountName" TEXT,
    "businessName" TEXT,
    "currency" TEXT,
    "timeZoneName" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaAdsConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaAdsConnection_tenantId_key" ON "MetaAdsConnection"("tenantId");

ALTER TABLE "MetaAdsConnection" ADD CONSTRAINT "MetaAdsConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
