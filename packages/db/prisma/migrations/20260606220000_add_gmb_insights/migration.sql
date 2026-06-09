-- CreateTable
CREATE TABLE "GmbInsightSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "mapsViews" INTEGER NOT NULL DEFAULT 0,
    "searchViews" INTEGER NOT NULL DEFAULT 0,
    "directSearches" INTEGER NOT NULL DEFAULT 0,
    "discoverySearches" INTEGER NOT NULL DEFAULT 0,
    "brandedSearches" INTEGER NOT NULL DEFAULT 0,
    "callClicks" INTEGER NOT NULL DEFAULT 0,
    "websiteClicks" INTEGER NOT NULL DEFAULT 0,
    "directionRequests" INTEGER NOT NULL DEFAULT 0,
    "messageClicks" INTEGER NOT NULL DEFAULT 0,
    "bookingClicks" INTEGER NOT NULL DEFAULT 0,
    "photoViews" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbInsightSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GmbInsightSnapshot_locationId_periodStart_periodEnd_key" ON "GmbInsightSnapshot"("locationId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "GmbInsightSnapshot_tenantId_periodStart_idx" ON "GmbInsightSnapshot"("tenantId", "periodStart");

-- CreateIndex
CREATE INDEX "GmbInsightSnapshot_locationId_periodStart_idx" ON "GmbInsightSnapshot"("locationId", "periodStart");

-- AddForeignKey
ALTER TABLE "GmbInsightSnapshot" ADD CONSTRAINT "GmbInsightSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbInsightSnapshot" ADD CONSTRAINT "GmbInsightSnapshot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GmbLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
