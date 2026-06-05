-- The final billing architecture removes artificial WhatsApp message caps
-- from plan tiers. Keep the column for an optional operational safety cap,
-- but use a high neutral default so new tenants are not constrained by plan
-- messaging allowances.
ALTER TABLE "Tenant" ALTER COLUMN "messageQuotaPerMonth" SET DEFAULT 1000000;
