-- CreateEnum
CREATE TYPE "SecretScope" AS ENUM ('PLATFORM', 'PARTNER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "SecretProvider" AS ENUM ('META', 'OPENAI', 'ANTHROPIC', 'GEMINI', 'DEEPSEEK', 'GROK', 'RAZORPAY', 'STRIPE', 'PAYPAL', 'PAYU', 'SMTP', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SecretStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "SecretVaultEntry" (
    "id" TEXT NOT NULL,
    "scope" "SecretScope" NOT NULL,
    "tenantId" TEXT,
    "provider" "SecretProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "last4" TEXT,
    "metadata" TEXT,
    "status" "SecretStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastRotatedAt" TIMESTAMP(3),
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecretVaultEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecretVaultEntry_scope_tenantId_idx" ON "SecretVaultEntry"("scope", "tenantId");

-- CreateIndex
CREATE INDEX "SecretVaultEntry_scope_tenantId_provider_idx" ON "SecretVaultEntry"("scope", "tenantId", "provider");

-- CreateIndex
CREATE INDEX "SecretVaultEntry_tenantId_status_idx" ON "SecretVaultEntry"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "SecretVaultEntry" ADD CONSTRAINT "SecretVaultEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
