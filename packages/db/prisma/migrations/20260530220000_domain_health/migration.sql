-- White-label Domain Health (PRD-v2 Sprint 5 slice 1)

-- Postgres requires enum value adds to live outside a transaction, but
-- prisma migrate wraps the file. The two ALTER TYPE statements below are
-- idempotent via DO blocks so a partial re-apply doesn't fail.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'DOMAIN_HEALTH_DEGRADED'
      AND enumtypid = '"PlatformActionCode"'::regtype
  ) THEN
    ALTER TYPE "PlatformActionCode" ADD VALUE 'DOMAIN_HEALTH_DEGRADED';
  END IF;
END
$$;

CREATE TYPE "DomainHealthOutcome" AS ENUM ('OK', 'DNS_DRIFT', 'SSL_FAILED', 'UNREACHABLE');

CREATE TABLE "DomainHealthSample" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partnerTenantId" TEXT,
    "outcome" "DomainHealthOutcome" NOT NULL,
    "cnameOk" BOOLEAN NOT NULL,
    "txtOk" BOOLEAN NOT NULL,
    "sslOk" BOOLEAN NOT NULL,
    "latencyMs" INTEGER,
    "error" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainHealthSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DomainHealthSample_domainId_observedAt_idx" ON "DomainHealthSample"("domainId", "observedAt" DESC);
CREATE INDEX "DomainHealthSample_tenantId_observedAt_idx" ON "DomainHealthSample"("tenantId", "observedAt" DESC);
CREATE INDEX "DomainHealthSample_partnerTenantId_outcome_observedAt_idx" ON "DomainHealthSample"("partnerTenantId", "outcome", "observedAt" DESC);

ALTER TABLE "DomainHealthSample"
  ADD CONSTRAINT "DomainHealthSample_domainId_fkey"
  FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
