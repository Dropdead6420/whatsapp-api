-- Manual bank transfer recharge (Claude FINAL §4 — RechargeRequest)
--
-- Customer files a request with proof; SuperAdmin approves and the
-- approval handler books a credit on the same WalletTransaction
-- ledger as Razorpay so audit history is consistent.

CREATE TYPE "RechargeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "RechargeRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "RechargeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "proofUrl" TEXT,
    "reference" TEXT,
    "customerNote" TEXT,
    "adminNotes" TEXT,
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "ledgerTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RechargeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RechargeRequest_tenantId_idx" ON "RechargeRequest"("tenantId");
CREATE INDEX "RechargeRequest_status_createdAt_idx" ON "RechargeRequest"("status", "createdAt");

ALTER TABLE "RechargeRequest"
  ADD CONSTRAINT "RechargeRequest_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
