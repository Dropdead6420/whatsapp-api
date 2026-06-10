-- CreateEnum
CREATE TYPE "GoogleApiLogStatus" AS ENUM ('OK', 'ERROR', 'RATE_LIMITED');

-- CreateTable
CREATE TABLE "GoogleApiLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "operation" TEXT NOT NULL,
    "status" "GoogleApiLogStatus" NOT NULL DEFAULT 'OK',
    "statusCode" INTEGER,
    "message" TEXT,
    "rateLimitRemaining" INTEGER,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleApiLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoogleApiLog_tenantId_createdAt_idx" ON "GoogleApiLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "GoogleApiLog_locationId_idx" ON "GoogleApiLog"("locationId");

-- CreateIndex
CREATE INDEX "GoogleApiLog_status_idx" ON "GoogleApiLog"("status");

-- AddForeignKey
ALTER TABLE "GoogleApiLog" ADD CONSTRAINT "GoogleApiLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
