-- Example/sample values for template variables, sent to Meta as component
-- `example` fields on submit ({ body: string[], header?: string }). Nullable —
-- existing rows are unaffected.
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "samples" JSONB;
