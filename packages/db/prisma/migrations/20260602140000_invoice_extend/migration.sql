-- Extend Invoice for self-recharge wallet (Claude FINAL §4 — slice 9)
--
-- New fields:
--   subtotalInPaisa, taxInPaisa  → tax breakdown (zero for now, future
--                                  GST/VAT calc writes them)
--   currency                     → currency code (default INR)
--   paymentOrderId               → link to Razorpay PaymentOrder
--   rechargeRequestId            → link to manual RechargeRequest
--   pdfUrl                       → CDN URL of the generated PDF (null
--                                  until the PDF worker slice ships)

ALTER TABLE "Invoice"
  ADD COLUMN "subtotalInPaisa"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taxInPaisa"         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "currency"           TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN "paymentOrderId"     TEXT,
  ADD COLUMN "rechargeRequestId"  TEXT,
  ADD COLUMN "pdfUrl"             TEXT;

CREATE INDEX "Invoice_paymentOrderId_idx" ON "Invoice"("paymentOrderId");
CREATE INDEX "Invoice_rechargeRequestId_idx" ON "Invoice"("rechargeRequestId");
