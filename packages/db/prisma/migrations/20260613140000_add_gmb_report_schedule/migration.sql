-- Opt-in recurring GMB report schedule (planning PDF §2 "AI Monthly Report …
-- frequency"). Soft tenant reference (no FK); one row per tenant, disabled by
-- default. A daily worker generates the period report when due.
CREATE TABLE "GmbReportSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" "GmbReportType" NOT NULL DEFAULT 'MONTHLY',
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GmbReportSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GmbReportSchedule_tenantId_key" ON "GmbReportSchedule"("tenantId");
CREATE INDEX "GmbReportSchedule_enabled_idx" ON "GmbReportSchedule"("enabled");
