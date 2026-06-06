-- CreateEnum
CREATE TYPE "LandingPageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "LandingPage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "blocks" JSONB,
    "theme" JSONB,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "status" "LandingPageStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LandingPage_tenantId_slug_key" ON "LandingPage"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "LandingPage_tenantId_status_idx" ON "LandingPage"("tenantId", "status");

-- CreateIndex
CREATE INDEX "LandingPage_tenantId_updatedAt_idx" ON "LandingPage"("tenantId", "updatedAt");

-- AddForeignKey
ALTER TABLE "LandingPage" ADD CONSTRAINT "LandingPage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
