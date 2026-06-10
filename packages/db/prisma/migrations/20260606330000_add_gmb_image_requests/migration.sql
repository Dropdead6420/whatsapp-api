-- CreateEnum
CREATE TYPE "GmbImageStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "GmbImageRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "subject" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "style" TEXT,
    "palette" TEXT,
    "size" TEXT NOT NULL DEFAULT '1024x1024',
    "quality" TEXT,
    "provider" TEXT,
    "secretId" TEXT,
    "status" "GmbImageStatus" NOT NULL DEFAULT 'PENDING',
    "resultUrl" TEXT,
    "error" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbImageRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GmbImageRequest_tenantId_status_idx" ON "GmbImageRequest"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "GmbImageRequest" ADD CONSTRAINT "GmbImageRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
