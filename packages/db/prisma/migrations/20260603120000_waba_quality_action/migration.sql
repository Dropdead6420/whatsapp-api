-- WABA quality monitor (Claude FINAL §10 — quality rating / messaging
-- limit / account status degradation surfaced to the SuperAdmin queue).
ALTER TYPE "PlatformActionCode" ADD VALUE IF NOT EXISTS 'WABA_QUALITY_DEGRADED';
