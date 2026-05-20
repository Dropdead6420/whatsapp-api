-- Create Branding table
CREATE TABLE "Branding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL UNIQUE,
    "logoUrl" TEXT,
    "logoSquareUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0066cc',
    "secondaryColor" TEXT NOT NULL DEFAULT '#f0f0f0',
    "accentColor" TEXT NOT NULL DEFAULT '#ff6600',
    "fontFamily" TEXT NOT NULL DEFAULT 'Inter',
    "fontUrl" TEXT,
    "customCss" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Branding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Branding_tenantId_idx" ON "Branding"("tenantId");

-- Create DemoTenant table
CREATE TABLE "DemoTenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL UNIQUE,
    "createdByPartnerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "renewalCount" INTEGER NOT NULL DEFAULT 0,
    "lastRenewedAt" TIMESTAMP(3),
    "sampleDataSeeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemoTenant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DemoTenant_createdByPartnerId_fkey" FOREIGN KEY ("createdByPartnerId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DemoTenant_createdByPartnerId_idx" ON "DemoTenant"("createdByPartnerId");
CREATE INDEX "DemoTenant_expiresAt_idx" ON "DemoTenant"("expiresAt");
CREATE INDEX "DemoTenant_tenantId_idx" ON "DemoTenant"("tenantId");
