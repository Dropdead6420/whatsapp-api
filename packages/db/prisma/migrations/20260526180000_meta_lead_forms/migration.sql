-- Meta Lead Ads → CRM auto-sync (PRD §3.3.6 slice 2).
-- One row per (tenant, formId). The polling worker reads `lastFetchedAt`
-- and stamps it after each successful fetch so we only import deltas.

CREATE TABLE "MetaAdsLeadForm" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "formName" TEXT,
    "pageId" TEXT,
    "pageName" TEXT,
    "importTag" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" TIMESTAMP(3),
    "lastFetchError" TEXT,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaAdsLeadForm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaAdsLeadForm_tenantId_formId_key" ON "MetaAdsLeadForm"("tenantId", "formId");
CREATE INDEX "MetaAdsLeadForm_tenantId_isActive_idx" ON "MetaAdsLeadForm"("tenantId", "isActive");
CREATE INDEX "MetaAdsLeadForm_isActive_lastFetchedAt_idx" ON "MetaAdsLeadForm"("isActive", "lastFetchedAt");

ALTER TABLE "MetaAdsLeadForm" ADD CONSTRAINT "MetaAdsLeadForm_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
