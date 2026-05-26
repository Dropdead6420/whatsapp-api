-- T-041: Custom email sender — extend Tenant.emailFromAddress (already
-- exists) with display name + DNS verification stamp + last error.

ALTER TABLE "Tenant"
  ADD COLUMN "emailFromName" TEXT,
  ADD COLUMN "emailDomainVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "emailDomainLastError" TEXT;
