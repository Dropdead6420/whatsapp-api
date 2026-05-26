-- T-021: auto-recharge configuration on Wallet.

-- AlterTable
ALTER TABLE "Wallet"
  ADD COLUMN "autoRechargeAmountCredits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "autoRechargePaymentMethodToken" TEXT,
  ADD COLUMN "autoRechargePaymentProvider" TEXT,
  ADD COLUMN "lastAutoRechargeAt" TIMESTAMP(3),
  ADD COLUMN "lastAutoRechargeError" TEXT;
