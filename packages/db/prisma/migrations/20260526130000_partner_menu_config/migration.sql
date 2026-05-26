-- Partner-portal sidebar customization (T-070).
-- Replaces the localStorage-only menu config used by /partner/menu.

ALTER TABLE "Tenant" ADD COLUMN "partnerMenuConfig" JSONB;
