-- CreateEnum
CREATE TYPE "KnowledgeBaseCategory" AS ENUM ('FAQ', 'SERVICE', 'PRODUCT', 'POLICY', 'HOURS', 'LOCATION', 'OTHER');

-- CreateEnum
CREATE TYPE "KnowledgeBaseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "KnowledgeBaseEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "category" "KnowledgeBaseCategory" NOT NULL DEFAULT 'FAQ',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "source" TEXT,
    "sourceUrl" TEXT,
    "status" "KnowledgeBaseStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "embeddingVector" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "embeddingModel" TEXT,
    "embeddingTextHash" TEXT,
    "lastEmbeddedAt" TIMESTAMP(3),
    "embeddingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBaseEntry_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "KnowledgeBaseEntry" ADD CONSTRAINT "KnowledgeBaseEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "KnowledgeBaseEntry_tenantId_status_idx" ON "KnowledgeBaseEntry"("tenantId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeBaseEntry_tenantId_category_idx" ON "KnowledgeBaseEntry"("tenantId", "category");

-- CreateIndex
CREATE INDEX "KnowledgeBaseEntry_tenantId_updatedAt_idx" ON "KnowledgeBaseEntry"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "KnowledgeBaseEntry_tenantId_lastEmbeddedAt_idx" ON "KnowledgeBaseEntry"("tenantId", "lastEmbeddedAt");
