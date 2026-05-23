-- CreateEnum
CREATE TYPE "AiAgentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AiAgentFallback" AS ENUM ('ESCALATE_TO_HUMAN', 'SEND_TEMPLATE', 'SILENT');

-- CreateTable
CREATE TABLE "AiAgent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "persona" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 800,
    "knowledgeScope" JSONB NOT NULL DEFAULT '{}',
    "tools" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "fallbackBehavior" "AiAgentFallback" NOT NULL DEFAULT 'ESCALATE_TO_HUMAN',
    "fallbackTemplateId" TEXT,
    "status" "AiAgentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAgent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AiAgent" ADD CONSTRAINT "AiAgent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "AiAgent_tenantId_status_idx" ON "AiAgent"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AiAgent_tenantId_updatedAt_idx" ON "AiAgent"("tenantId", "updatedAt");
