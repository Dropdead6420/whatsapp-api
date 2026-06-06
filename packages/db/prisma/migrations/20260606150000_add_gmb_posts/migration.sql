-- CreateEnum
CREATE TYPE "GmbPostType" AS ENUM ('UPDATE', 'OFFER', 'EVENT');

-- CreateEnum
CREATE TYPE "GmbPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "GmbPost" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "GmbPostType" NOT NULL DEFAULT 'UPDATE',
    "summary" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "callToActionType" TEXT,
    "callToActionUrl" TEXT,
    "locationLabel" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "status" "GmbPostStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GmbPost_tenantId_status_idx" ON "GmbPost"("tenantId", "status");

-- CreateIndex
CREATE INDEX "GmbPost_tenantId_scheduledAt_idx" ON "GmbPost"("tenantId", "scheduledAt");

-- AddForeignKey
ALTER TABLE "GmbPost" ADD CONSTRAINT "GmbPost_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
