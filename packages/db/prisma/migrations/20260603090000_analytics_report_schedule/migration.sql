CREATE TYPE "AnalyticsReportScope" AS ENUM ('PLATFORM', 'TENANT');
CREATE TYPE "AnalyticsReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "AnalyticsReportFormat" AS ENUM ('CSV', 'PDF');
CREATE TYPE "AnalyticsReportStatus" AS ENUM ('SENT', 'FAILED', 'NEVER_RUN');

CREATE TABLE "AnalyticsReportSchedule" (
  "id" TEXT NOT NULL,
  "scheduleKey" TEXT NOT NULL,
  "scope" "AnalyticsReportScope" NOT NULL,
  "tenantId" TEXT,
  "recipientEmail" TEXT NOT NULL,
  "frequency" "AnalyticsReportFrequency" NOT NULL DEFAULT 'WEEKLY',
  "format" "AnalyticsReportFormat" NOT NULL DEFAULT 'PDF',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "lastRunAt" TIMESTAMP(3),
  "lastSentAt" TIMESTAMP(3),
  "lastStatus" "AnalyticsReportStatus" NOT NULL DEFAULT 'NEVER_RUN',
  "lastError" TEXT,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalyticsReportSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsReportSchedule_scheduleKey_key"
  ON "AnalyticsReportSchedule"("scheduleKey");

CREATE INDEX "AnalyticsReportSchedule_enabled_nextRunAt_idx"
  ON "AnalyticsReportSchedule"("enabled", "nextRunAt");

CREATE INDEX "AnalyticsReportSchedule_scope_tenantId_idx"
  ON "AnalyticsReportSchedule"("scope", "tenantId");

ALTER TABLE "AnalyticsReportSchedule"
  ADD CONSTRAINT "AnalyticsReportSchedule_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
