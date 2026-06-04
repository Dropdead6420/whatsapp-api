-- Final Currency/Language PDF §7: currency master/settings + immutable
-- wallet/invoice currency snapshots.

CREATE TABLE "Currency" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "minorUnit" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isLaunchCurrency" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "CustomerCurrencySetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "showConvertedAmounts" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCurrencySetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerCurrencySetting" (
    "id" TEXT NOT NULL,
    "partnerTenantId" TEXT NOT NULL,
    "defaultCurrencyCode" TEXT NOT NULL DEFAULT 'INR',
    "settlementCurrencyCode" TEXT NOT NULL DEFAULT 'INR',
    "allowedCurrencies" JSONB,
    "passThroughCustomerCurrency" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerCurrencySetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WalletCurrencyLedger" (
    "id" TEXT NOT NULL,
    "walletTransactionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "walletType" "WalletType" NOT NULL,
    "ledgerCurrency" TEXT NOT NULL DEFAULT 'INR',
    "amountCredits" INTEGER NOT NULL,
    "balanceAfterCredits" INTEGER NOT NULL,
    "creditUnitMinor" INTEGER NOT NULL DEFAULT 1,
    "amountMinor" INTEGER NOT NULL DEFAULT 0,
    "displayCurrency" TEXT NOT NULL DEFAULT 'INR',
    "displayRateMicros" BIGINT NOT NULL DEFAULT 1000000,
    "displayAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "sourceCurrency" TEXT,
    "sourceAmountMinor" INTEGER,
    "sourceToLedgerRateMicros" BIGINT,
    "snapshotReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletCurrencyLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceCurrency" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceCurrency" TEXT NOT NULL DEFAULT 'INR',
    "amountMinor" INTEGER NOT NULL,
    "subtotalMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL,
    "displayCurrency" TEXT NOT NULL DEFAULT 'INR',
    "exchangeRateMicros" BIGINT NOT NULL DEFAULT 1000000,
    "displayAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "snapshotJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceCurrency_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Currency" ("code", "name", "symbol", "minorUnit", "isLaunchCurrency", "displayOrder", "updatedAt")
VALUES
  ('INR', 'Indian Rupee', '₹', 2, true, 10, CURRENT_TIMESTAMP),
  ('USD', 'US Dollar', '$', 2, true, 20, CURRENT_TIMESTAMP),
  ('CAD', 'Canadian Dollar', 'CA$', 2, true, 30, CURRENT_TIMESTAMP),
  ('AED', 'UAE Dirham', 'د.إ', 2, true, 40, CURRENT_TIMESTAMP),
  ('GBP', 'British Pound', '£', 2, true, 50, CURRENT_TIMESTAMP),
  ('EUR', 'Euro', '€', 2, true, 60, CURRENT_TIMESTAMP),
  ('AUD', 'Australian Dollar', 'A$', 2, true, 70, CURRENT_TIMESTAMP),
  ('SGD', 'Singapore Dollar', 'S$', 2, true, 80, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "symbol" = EXCLUDED."symbol",
  "minorUnit" = EXCLUDED."minorUnit",
  "isLaunchCurrency" = EXCLUDED."isLaunchCurrency",
  "displayOrder" = EXCLUDED."displayOrder",
  "updatedAt" = CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "CustomerCurrencySetting_tenantId_key" ON "CustomerCurrencySetting"("tenantId");
CREATE INDEX "CustomerCurrencySetting_currencyCode_idx" ON "CustomerCurrencySetting"("currencyCode");

CREATE UNIQUE INDEX "PartnerCurrencySetting_partnerTenantId_key" ON "PartnerCurrencySetting"("partnerTenantId");
CREATE INDEX "PartnerCurrencySetting_defaultCurrencyCode_idx" ON "PartnerCurrencySetting"("defaultCurrencyCode");
CREATE INDEX "PartnerCurrencySetting_settlementCurrencyCode_idx" ON "PartnerCurrencySetting"("settlementCurrencyCode");

CREATE UNIQUE INDEX "WalletCurrencyLedger_walletTransactionId_key" ON "WalletCurrencyLedger"("walletTransactionId");
CREATE INDEX "WalletCurrencyLedger_tenantId_createdAt_idx" ON "WalletCurrencyLedger"("tenantId", "createdAt");
CREATE INDEX "WalletCurrencyLedger_walletId_createdAt_idx" ON "WalletCurrencyLedger"("walletId", "createdAt");
CREATE INDEX "WalletCurrencyLedger_ledgerCurrency_idx" ON "WalletCurrencyLedger"("ledgerCurrency");
CREATE INDEX "WalletCurrencyLedger_displayCurrency_idx" ON "WalletCurrencyLedger"("displayCurrency");

CREATE UNIQUE INDEX "InvoiceCurrency_invoiceId_key" ON "InvoiceCurrency"("invoiceId");
CREATE INDEX "InvoiceCurrency_tenantId_createdAt_idx" ON "InvoiceCurrency"("tenantId", "createdAt");
CREATE INDEX "InvoiceCurrency_invoiceCurrency_idx" ON "InvoiceCurrency"("invoiceCurrency");
CREATE INDEX "InvoiceCurrency_displayCurrency_idx" ON "InvoiceCurrency"("displayCurrency");

ALTER TABLE "CustomerCurrencySetting" ADD CONSTRAINT "CustomerCurrencySetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerCurrencySetting" ADD CONSTRAINT "PartnerCurrencySetting_partnerTenantId_fkey" FOREIGN KEY ("partnerTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletCurrencyLedger" ADD CONSTRAINT "WalletCurrencyLedger_walletTransactionId_fkey" FOREIGN KEY ("walletTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletCurrencyLedger" ADD CONSTRAINT "WalletCurrencyLedger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletCurrencyLedger" ADD CONSTRAINT "WalletCurrencyLedger_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceCurrency" ADD CONSTRAINT "InvoiceCurrency_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceCurrency" ADD CONSTRAINT "InvoiceCurrency_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
