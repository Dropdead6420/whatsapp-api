-- CreateEnum
CREATE TYPE "AnalyticsReportType" AS ENUM ('CAMPAIGN_PERFORMANCE', 'LEAD_FUNNEL', 'CONTACT_GROWTH', 'AI_USAGE');

-- CreateEnum
CREATE TYPE "AnalyticsReportFrequency" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "AnalyticsReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdById" TEXT,
    "name" TEXT NOT NULL,
    "type" "AnalyticsReportType" NOT NULL,
    "frequency" "AnalyticsReportFrequency" NOT NULL DEFAULT 'NONE',
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filters" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastDeliveryStatus" TEXT,
    "lastDeliveryError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsReport_tenantId_idx" ON "AnalyticsReport"("tenantId");

-- CreateIndex
CREATE INDEX "AnalyticsReport_type_idx" ON "AnalyticsReport"("type");

-- CreateIndex
CREATE INDEX "AnalyticsReport_frequency_idx" ON "AnalyticsReport"("frequency");

-- CreateIndex
CREATE INDEX "AnalyticsReport_nextRunAt_idx" ON "AnalyticsReport"("nextRunAt");

-- AddForeignKey
ALTER TABLE "AnalyticsReport" ADD CONSTRAINT "AnalyticsReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsReport" ADD CONSTRAINT "AnalyticsReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
