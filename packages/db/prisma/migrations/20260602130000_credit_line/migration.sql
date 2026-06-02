-- Postpaid credit line (Claude FINAL §4 — CreditLine)
--
-- Source-of-truth for "tenant has a credit line" with approver trail
-- and due-date metadata. Wallet.creditLimit + Wallet.billingMode are
-- kept in sync by the service layer; this row is what finance and
-- compliance read.

CREATE TYPE "CreditLineStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

CREATE TABLE "CreditLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "limitCredits" INTEGER NOT NULL,
    "status" "CreditLineStatus" NOT NULL DEFAULT 'ACTIVE',
    "dueDate" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "notes" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CreditLine_tenantId_status_idx" ON "CreditLine"("tenantId", "status");
CREATE INDEX "CreditLine_status_dueDate_idx" ON "CreditLine"("status", "dueDate");

ALTER TABLE "CreditLine"
  ADD CONSTRAINT "CreditLine_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Belt-and-suspenders: only one ACTIVE line per tenant. (SUSPENDED /
-- CLOSED lines stay around for audit, so a partial unique index is
-- the right shape.)
CREATE UNIQUE INDEX "CreditLine_tenantId_active_unique"
  ON "CreditLine"("tenantId")
  WHERE "status" = 'ACTIVE';
