-- Richer WhatsApp template components (header media type + typed buttons),
-- matching Meta's template builder. All nullable/defaulted — existing rows
-- (text-only templates) are unaffected.
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "headerType" TEXT DEFAULT 'NONE';
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "headerMediaUrl" TEXT;
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "buttons" JSONB;
