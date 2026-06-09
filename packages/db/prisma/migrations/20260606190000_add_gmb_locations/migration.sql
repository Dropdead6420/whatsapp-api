-- CreateEnum
CREATE TYPE "GmbLocationStatus" AS ENUM ('DRAFT', 'CONNECTED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "GmbLocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storeCode" TEXT,
    "placeId" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "primaryCategory" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "status" "GmbLocationStatus" NOT NULL DEFAULT 'DRAFT',
    "verificationState" TEXT,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "secretId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GmbLocation_tenantId_status_idx" ON "GmbLocation"("tenantId", "status");

-- CreateIndex
CREATE INDEX "GmbLocation_tenantId_placeId_idx" ON "GmbLocation"("tenantId", "placeId");

-- AddForeignKey
ALTER TABLE "GmbLocation" ADD CONSTRAINT "GmbLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
