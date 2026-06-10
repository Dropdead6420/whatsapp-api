-- CreateEnum
CREATE TYPE "GmbReportType" AS ENUM ('WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateTable
CREATE TABLE "GmbReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "type" "GmbReportType" NOT NULL DEFAULT 'MONTHLY',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "summary" TEXT,
    "actionPlan" JSONB,
    "generatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmbReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GmbReport_tenantId_type_idx" ON "GmbReport"("tenantId", "type");

-- CreateIndex
CREATE INDEX "GmbReport_locationId_idx" ON "GmbReport"("locationId");

-- AddForeignKey
ALTER TABLE "GmbReport" ADD CONSTRAINT "GmbReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbReport" ADD CONSTRAINT "GmbReport_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GmbLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
