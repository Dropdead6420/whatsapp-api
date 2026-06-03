-- Platform FX rates (Claude Corrected Billing §3 — multi-currency).
-- 1 unit of baseCurrency = rateMicros / 1_000_000 units of quoteCurrency.
-- Effective-dated like the WhatsApp rate table; the rate engine resolves
-- UsageEvent.currencyRateMicros from the active row for the currency pair.

CREATE TABLE "CurrencyRate" (
  "id"              TEXT NOT NULL,
  "baseCurrency"    TEXT NOT NULL,
  "quoteCurrency"   TEXT NOT NULL,
  "rateMicros"      BIGINT NOT NULL,
  "source"          TEXT,
  "notes"           TEXT,
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo"     TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CurrencyRate_pair_active_from_idx"
  ON "CurrencyRate" ("baseCurrency", "quoteCurrency", "isActive", "effectiveFrom");
