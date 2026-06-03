-- Split customer funds into typed wallets.
--
-- Existing one-wallet-per-tenant rows become WHATSAPP_USAGE wallets so
-- current balances, credit lines, recharges, and message debits keep working.
-- New AI_CREDIT wallets can now be created independently for AI billing.

CREATE TYPE "WalletType" AS ENUM (
  'WHATSAPP_USAGE',
  'AI_CREDIT',
  'PARTNER_CREDIT'
);

ALTER TABLE "Wallet"
  ADD COLUMN "type" "WalletType" NOT NULL DEFAULT 'WHATSAPP_USAGE';

ALTER TABLE "PaymentOrder"
  ADD COLUMN "walletType" "WalletType" NOT NULL DEFAULT 'WHATSAPP_USAGE';

ALTER TABLE "RechargeRequest"
  ADD COLUMN "walletType" "WalletType" NOT NULL DEFAULT 'WHATSAPP_USAGE';

DROP INDEX "Wallet_tenantId_key";

CREATE UNIQUE INDEX "Wallet_tenantId_type_key"
  ON "Wallet"("tenantId", "type");

CREATE INDEX "Wallet_tenantId_idx"
  ON "Wallet"("tenantId");

CREATE INDEX "Wallet_type_idx"
  ON "Wallet"("type");
