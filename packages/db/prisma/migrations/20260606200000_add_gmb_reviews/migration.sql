-- CreateEnum
CREATE TYPE "GmbReviewStatus" AS ENUM ('NEW', 'REPLIED', 'FLAGGED');

-- CreateTable
CREATE TABLE "GmbReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "externalReviewId" TEXT,
    "authorName" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "status" "GmbReviewStatus" NOT NULL DEFAULT 'NEW',
    "replyText" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GmbReview_tenantId_status_idx" ON "GmbReview"("tenantId", "status");

-- CreateIndex
CREATE INDEX "GmbReview_locationId_idx" ON "GmbReview"("locationId");

-- AddForeignKey
ALTER TABLE "GmbReview" ADD CONSTRAINT "GmbReview_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmbReview" ADD CONSTRAINT "GmbReview_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GmbLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
