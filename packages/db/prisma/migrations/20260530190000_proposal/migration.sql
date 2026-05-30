-- AI Proposal Generator (PRD-v2 Sprint 3 slice 4)

CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED');

CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "partnerTenantId" TEXT NOT NULL,
    "prospectName" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "brief" JSONB NOT NULL DEFAULT '{}',
    "content" JSONB NOT NULL DEFAULT '{}',
    "title" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "estimatedValue" INTEGER,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'ai',
    "shareToken" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Proposal_shareToken_key" ON "Proposal"("shareToken");
CREATE INDEX "Proposal_partnerTenantId_createdAt_idx" ON "Proposal"("partnerTenantId", "createdAt" DESC);
CREATE INDEX "Proposal_partnerTenantId_status_idx" ON "Proposal"("partnerTenantId", "status");

ALTER TABLE "Proposal"
  ADD CONSTRAINT "Proposal_partnerTenantId_fkey"
  FOREIGN KEY ("partnerTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
