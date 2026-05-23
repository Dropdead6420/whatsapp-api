-- T-052 slice 4: default-agent flag + tenant auto-reply switch

-- AlterTable
ALTER TABLE "AiAgent" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "aiAgentAutoReply" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex — composite for the inbound fallback lookup
CREATE INDEX "AiAgent_tenantId_isDefault_status_idx" ON "AiAgent"("tenantId", "isDefault", "status");
