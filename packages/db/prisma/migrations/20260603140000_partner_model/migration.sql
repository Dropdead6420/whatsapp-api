-- Partner models A/B/C (Claude Final Corrected Billing §4)
--
-- partnerModel + partnerMarginEnabled live on the WHITE_LABEL partner
-- tenant; providerOwnership + creditSource are per customer (BUSINESS)
-- tenant so a HYBRID partner can mix routes/credit sources.

CREATE TYPE "PartnerModel" AS ENUM ('RESELLER', 'BRING_YOUR_OWN_META', 'HYBRID');
CREATE TYPE "ProviderOwnership" AS ENUM ('NEXAFLOW_OWNED', 'PARTNER_OWNED', 'CUSTOMER_OWNED');
CREATE TYPE "CreditSource" AS ENUM ('CUSTOMER_WALLET', 'PARTNER_WALLET', 'PARTNER_CREDIT_LINE', 'CUSTOMER_CREDIT_LINE');

ALTER TABLE "Tenant"
  ADD COLUMN "partnerModel"         "PartnerModel",
  ADD COLUMN "partnerMarginEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "providerOwnership"    "ProviderOwnership" NOT NULL DEFAULT 'NEXAFLOW_OWNED',
  ADD COLUMN "creditSource"         "CreditSource" NOT NULL DEFAULT 'CUSTOMER_WALLET';
