-- Meta Custom Audience exports (PRD §3.3.6 retargeting slice).

CREATE TYPE "MetaAudienceStatus" AS ENUM ('CREATING', 'READY', 'REFRESHING', 'FAILED');

CREATE TABLE "MetaAdsAudience" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metaAudienceId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "filterSpec" JSONB NOT NULL DEFAULT '{}',
    "status" "MetaAudienceStatus" NOT NULL DEFAULT 'CREATING',
    "lastSyncError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "contactCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaAdsAudience_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaAdsAudience_tenantId_name_key" ON "MetaAdsAudience"("tenantId", "name");
CREATE INDEX "MetaAdsAudience_tenantId_status_idx" ON "MetaAdsAudience"("tenantId", "status");

ALTER TABLE "MetaAdsAudience" ADD CONSTRAINT "MetaAdsAudience_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
