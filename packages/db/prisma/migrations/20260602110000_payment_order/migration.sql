-- Customer self-recharge wallet foundation (Claude FINAL §4)
--
-- PaymentOrder tracks one customer-initiated checkout. PaymentWebhookLog
-- gives us idempotent webhook handling (gateway + eventId UNIQUE) and
-- the audit trail required by the PRD.

CREATE TYPE "PaymentGateway" AS ENUM ('RAZORPAY', 'STRIPE');
CREATE TYPE "PaymentOrderStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "PaymentWebhookSignatureStatus" AS ENUM ('VALID', 'INVALID', 'MISSING');

CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'CREATED',
    "gatewayOrderId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "ledgerTransactionId" TEXT,
    "failureReason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- (tenantId, idempotencyKey) UNIQUE prevents double-click double-create.
CREATE UNIQUE INDEX "PaymentOrder_tenantId_idempotencyKey_key" ON "PaymentOrder"("tenantId", "idempotencyKey");
-- (gateway, gatewayOrderId) UNIQUE makes the gateway → our-row lookup
-- a guaranteed single match. NULL gatewayOrderId is allowed for
-- never-initialized rows (gateway create failed); Postgres treats NULL
-- as distinct so multiple un-initialized rows don't collide.
CREATE UNIQUE INDEX "PaymentOrder_gateway_gatewayOrderId_key" ON "PaymentOrder"("gateway", "gatewayOrderId");
CREATE INDEX "PaymentOrder_tenantId_idx" ON "PaymentOrder"("tenantId");
CREATE INDEX "PaymentOrder_walletId_idx" ON "PaymentOrder"("walletId");
CREATE INDEX "PaymentOrder_status_createdAt_idx" ON "PaymentOrder"("status", "createdAt");

ALTER TABLE "PaymentOrder"
  ADD CONSTRAINT "PaymentOrder_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentOrder"
  ADD CONSTRAINT "PaymentOrder_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PaymentWebhookLog" (
    "id" TEXT NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "signatureStatus" "PaymentWebhookSignatureStatus" NOT NULL,
    "paymentOrderId" TEXT,
    "rawPayload" TEXT NOT NULL,
    "duplicate" BOOLEAN NOT NULL DEFAULT false,
    "processingError" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookLog_pkey" PRIMARY KEY ("id")
);

-- (gateway, eventId) UNIQUE is the webhook idempotency surface:
-- a retried Razorpay/Stripe event collides on insert, so the handler
-- can detect the duplicate and skip the credit step.
CREATE UNIQUE INDEX "PaymentWebhookLog_gateway_eventId_key" ON "PaymentWebhookLog"("gateway", "eventId");
CREATE INDEX "PaymentWebhookLog_gateway_processedAt_idx" ON "PaymentWebhookLog"("gateway", "processedAt");
CREATE INDEX "PaymentWebhookLog_paymentOrderId_idx" ON "PaymentWebhookLog"("paymentOrderId");

ALTER TABLE "PaymentWebhookLog"
  ADD CONSTRAINT "PaymentWebhookLog_paymentOrderId_fkey"
  FOREIGN KEY ("paymentOrderId") REFERENCES "PaymentOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
