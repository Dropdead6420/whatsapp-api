-- CreateEnum
CREATE TYPE "CmsContentType" AS ENUM ('PAGE', 'BLOG', 'FAQ', 'TESTIMONIAL', 'LEGAL', 'SEO_META');

-- CreateEnum
CREATE TYPE "CmsContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "CmsContent" (
    "id" TEXT NOT NULL,
    "type" "CmsContentType" NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "body" TEXT,
    "data" JSONB,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "status" "CmsContentStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CmsContent_type_slug_locale_key" ON "CmsContent"("type", "slug", "locale");

-- CreateIndex
CREATE INDEX "CmsContent_type_status_sortOrder_idx" ON "CmsContent"("type", "status", "sortOrder");
