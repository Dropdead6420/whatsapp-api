-- CreateEnum
CREATE TYPE "VirtualNumberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'RELEASED');

-- CreateTable
CREATE TABLE "VirtualNumber" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "label" TEXT,
    "countryCode" TEXT,
    "provider" TEXT,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secretId" TEXT,
    "status" "VirtualNumberStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualNumber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VirtualNumber_tenantId_phoneNumber_key" ON "VirtualNumber"("tenantId", "phoneNumber");

-- CreateIndex
CREATE INDEX "VirtualNumber_tenantId_status_idx" ON "VirtualNumber"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "VirtualNumber" ADD CONSTRAINT "VirtualNumber_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
