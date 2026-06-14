-- Marketing template sub-types (Catalogue / Flows / Order Details / Carousel).
-- templateType discriminates the composer; catalogFormat is set for Catalogue
-- templates; carousel holds the per-card structure for Carousel templates.
-- All nullable/defaulted — existing rows remain valid standard templates.
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "templateType" TEXT DEFAULT 'CUSTOM';
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "catalogFormat" TEXT;
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "carousel" JSONB;
