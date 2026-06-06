-- Product Marketplace Access Layer
-- Customer is public terminology; Tenant remains the internal compatibility model.

CREATE TYPE "ProductCategory" AS ENUM (
  'CORE',
  'AI',
  'AUTOMATION',
  'BILLING',
  'INTEGRATION',
  'SUPPORT',
  'DEVELOPER',
  'COMPLIANCE',
  'MARKETING'
);

CREATE TYPE "ProductAccessSource" AS ENUM (
  'GLOBAL',
  'SUPER_ADMIN',
  'PARTNER',
  'PLAN',
  'LEGACY'
);

CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" "ProductCategory" NOT NULL DEFAULT 'CORE',
  "description" TEXT,
  "routeHref" TEXT,
  "featureKey" TEXT,
  "icon" TEXT,
  "isGlobalEnabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 1000,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductAddOn" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "priceInPaisa" INTEGER NOT NULL DEFAULT 0,
  "billingCycle" TEXT NOT NULL DEFAULT 'monthly',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductAddOn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerProductAccess" (
  "id" TEXT NOT NULL,
  "partnerTenantId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "limits" JSONB,
  "source" "ProductAccessSource" NOT NULL DEFAULT 'SUPER_ADMIN',
  "expiresAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PartnerProductAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerProductAccess" (
  "id" TEXT NOT NULL,
  "customerTenantId" TEXT NOT NULL,
  "partnerTenantId" TEXT,
  "productId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "limits" JSONB,
  "source" "ProductAccessSource" NOT NULL DEFAULT 'SUPER_ADMIN',
  "expiresAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerProductAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Product_key_key" ON "Product"("key");
CREATE INDEX "Product_category_sortOrder_idx" ON "Product"("category", "sortOrder");
CREATE INDEX "Product_featureKey_idx" ON "Product"("featureKey");
CREATE INDEX "Product_isGlobalEnabled_idx" ON "Product"("isGlobalEnabled");

CREATE UNIQUE INDEX "ProductAddOn_productId_key_key" ON "ProductAddOn"("productId", "key");
CREATE INDEX "ProductAddOn_isActive_idx" ON "ProductAddOn"("isActive");

CREATE UNIQUE INDEX "PartnerProductAccess_partnerTenantId_productId_key" ON "PartnerProductAccess"("partnerTenantId", "productId");
CREATE INDEX "PartnerProductAccess_partnerTenantId_enabled_idx" ON "PartnerProductAccess"("partnerTenantId", "enabled");
CREATE INDEX "PartnerProductAccess_productId_enabled_idx" ON "PartnerProductAccess"("productId", "enabled");

CREATE UNIQUE INDEX "CustomerProductAccess_customerTenantId_productId_key" ON "CustomerProductAccess"("customerTenantId", "productId");
CREATE INDEX "CustomerProductAccess_customerTenantId_enabled_idx" ON "CustomerProductAccess"("customerTenantId", "enabled");
CREATE INDEX "CustomerProductAccess_partnerTenantId_enabled_idx" ON "CustomerProductAccess"("partnerTenantId", "enabled");
CREATE INDEX "CustomerProductAccess_productId_enabled_idx" ON "CustomerProductAccess"("productId", "enabled");

ALTER TABLE "ProductAddOn" ADD CONSTRAINT "ProductAddOn_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartnerProductAccess" ADD CONSTRAINT "PartnerProductAccess_partnerTenantId_fkey"
  FOREIGN KEY ("partnerTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartnerProductAccess" ADD CONSTRAINT "PartnerProductAccess_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerProductAccess" ADD CONSTRAINT "CustomerProductAccess_customerTenantId_fkey"
  FOREIGN KEY ("customerTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerProductAccess" ADD CONSTRAINT "CustomerProductAccess_partnerTenantId_fkey"
  FOREIGN KEY ("partnerTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerProductAccess" ADD CONSTRAINT "CustomerProductAccess_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
