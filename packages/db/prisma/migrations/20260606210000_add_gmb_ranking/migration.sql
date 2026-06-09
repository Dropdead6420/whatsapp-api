-- CreateTable
CREATE TABLE "GmbTrackedKeyword" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbTrackedKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmbRankSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "rank" INTEGER,
    "source" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmbRankSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GmbTrackedKeyword_locationId_keyword_key" ON "GmbTrackedKeyword"("locationId", "keyword");

-- CreateIndex
CREATE INDEX "GmbTrackedKeyword_tenantId_isActive_idx" ON "GmbTrackedKeyword"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "GmbRankSnapshot_keywordId_checkedAt_idx" ON "GmbRankSnapshot"("keywordId", "checkedAt");

-- CreateIndex
CREATE INDEX "GmbRankSnapshot_tenantId_idx" ON "GmbRankSnapshot"("tenantId");

-- AddForeignKey
ALTER TABLE "GmbTrackedKeyword" ADD CONSTRAINT "GmbTrackedKeyword_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbTrackedKeyword" ADD CONSTRAINT "GmbTrackedKeyword_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GmbLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbRankSnapshot" ADD CONSTRAINT "GmbRankSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbRankSnapshot" ADD CONSTRAINT "GmbRankSnapshot_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "GmbTrackedKeyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
