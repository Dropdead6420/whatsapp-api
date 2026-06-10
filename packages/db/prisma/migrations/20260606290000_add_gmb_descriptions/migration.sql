-- CreateEnum
CREATE TYPE "GmbDescriptionTarget" AS ENUM ('BUSINESS', 'SERVICE', 'PRODUCT');

-- CreateEnum
CREATE TYPE "GmbDescriptionStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "GmbDescription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "target" "GmbDescriptionTarget" NOT NULL DEFAULT 'BUSINESS',
    "label" TEXT,
    "original" TEXT NOT NULL,
    "optimized" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxLength" INTEGER,
    "analysis" JSONB,
    "status" "GmbDescriptionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbDescription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GmbDescription_tenantId_status_idx" ON "GmbDescription"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "GmbDescription" ADD CONSTRAINT "GmbDescription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
