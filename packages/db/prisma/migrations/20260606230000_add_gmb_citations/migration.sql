-- CreateEnum
CREATE TYPE "GmbCitationStatus" AS ENUM ('LIVE', 'PENDING', 'MISSING');

-- CreateTable
CREATE TABLE "GmbCitation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "directory" TEXT NOT NULL,
    "listingUrl" TEXT,
    "napName" TEXT,
    "napAddress" TEXT,
    "napPhone" TEXT,
    "status" "GmbCitationStatus" NOT NULL DEFAULT 'PENDING',
    "lastCheckedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbCitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GmbCitation_locationId_directory_key" ON "GmbCitation"("locationId", "directory");

-- CreateIndex
CREATE INDEX "GmbCitation_tenantId_status_idx" ON "GmbCitation"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "GmbCitation" ADD CONSTRAINT "GmbCitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbCitation" ADD CONSTRAINT "GmbCitation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GmbLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
