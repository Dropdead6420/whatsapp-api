-- CreateEnum
CREATE TYPE "ManagedServiceInterval" AS ENUM ('ONE_TIME', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ManagedServiceStatus" AS ENUM ('REQUESTED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ManagedServicePackage" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "priceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "interval" "ManagedServiceInterval" NOT NULL DEFAULT 'MONTHLY',
    "deliverables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedServicePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedServiceEngagement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "locationId" TEXT,
    "status" "ManagedServiceStatus" NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,
    "priceCentsSnapshot" INTEGER,
    "currency" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assignedToUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedServiceEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagedServicePackage_key_key" ON "ManagedServicePackage"("key");

-- CreateIndex
CREATE INDEX "ManagedServicePackage_isActive_sortOrder_idx" ON "ManagedServicePackage"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "ManagedServiceEngagement_tenantId_status_idx" ON "ManagedServiceEngagement"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ManagedServiceEngagement_packageId_idx" ON "ManagedServiceEngagement"("packageId");

-- AddForeignKey
ALTER TABLE "ManagedServiceEngagement" ADD CONSTRAINT "ManagedServiceEngagement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedServiceEngagement" ADD CONSTRAINT "ManagedServiceEngagement_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ManagedServicePackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
