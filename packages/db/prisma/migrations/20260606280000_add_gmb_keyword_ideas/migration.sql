-- CreateTable
CREATE TABLE "GmbKeywordIdeaSet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "category" TEXT,
    "city" TEXT,
    "region" TEXT,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "competitors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ideas" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmbKeywordIdeaSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GmbKeywordIdeaSet_tenantId_idx" ON "GmbKeywordIdeaSet"("tenantId");

-- AddForeignKey
ALTER TABLE "GmbKeywordIdeaSet" ADD CONSTRAINT "GmbKeywordIdeaSet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
