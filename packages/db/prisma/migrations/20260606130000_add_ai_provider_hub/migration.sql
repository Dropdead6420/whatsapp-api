-- CreateEnum
CREATE TYPE "AiProviderKey" AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI', 'DEEPSEEK', 'GROK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'VOICE', 'EMBEDDING');

-- CreateEnum
CREATE TYPE "AiProviderStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "AiProviderConfig" (
    "id" TEXT NOT NULL,
    "scope" "SecretScope" NOT NULL,
    "tenantId" TEXT,
    "provider" "AiProviderKey" NOT NULL,
    "kind" "AiProviderKind" NOT NULL DEFAULT 'TEXT',
    "label" TEXT NOT NULL,
    "secretId" TEXT,
    "defaultModel" TEXT,
    "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "baseUrl" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "AiProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiProviderConfig_scope_tenantId_idx" ON "AiProviderConfig"("scope", "tenantId");

-- CreateIndex
CREATE INDEX "AiProviderConfig_scope_tenantId_kind_status_priority_idx" ON "AiProviderConfig"("scope", "tenantId", "kind", "status", "priority");

-- CreateIndex
CREATE INDEX "AiProviderConfig_secretId_idx" ON "AiProviderConfig"("secretId");

-- AddForeignKey
ALTER TABLE "AiProviderConfig" ADD CONSTRAINT "AiProviderConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
