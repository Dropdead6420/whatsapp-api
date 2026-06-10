-- CreateTable
CREATE TABLE "GmbAdvisorReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "score" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "breakdown" JSONB NOT NULL,
    "tasks" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmbAdvisorReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GmbAdvisorReport_tenantId_idx" ON "GmbAdvisorReport"("tenantId");

-- AddForeignKey
ALTER TABLE "GmbAdvisorReport" ADD CONSTRAINT "GmbAdvisorReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
