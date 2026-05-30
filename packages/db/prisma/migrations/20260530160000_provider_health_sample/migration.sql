-- Provider Router telemetry (PRD-v2 §8, Sprint 2 slice 1).
-- Append-only sample table written by the WhatsApp send pipeline on every
-- outbound send. Aggregations drive the SuperAdmin per-tenant stats view
-- today; smart provider selection on top of these stats lands in slice 2.

CREATE TYPE "WhatsAppSendKind" AS ENUM ('TEXT', 'TEMPLATE');

CREATE TABLE "ProviderHealthSample" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerKey" "WhatsAppProviderKey" NOT NULL,
    "phoneNumberId" TEXT,
    "kind" "WhatsAppSendKind" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "statusCode" INTEGER,
    "errorCode" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderHealthSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderHealthSample_tenantId_providerKey_createdAt_idx" ON "ProviderHealthSample"("tenantId", "providerKey", "createdAt");
CREATE INDEX "ProviderHealthSample_providerKey_createdAt_idx" ON "ProviderHealthSample"("providerKey", "createdAt");

ALTER TABLE "ProviderHealthSample" ADD CONSTRAINT "ProviderHealthSample_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
