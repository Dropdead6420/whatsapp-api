-- Overdue credit-line monitor (Claude FINAL §5 — "overdue suspension" worker)
--
-- Adds the PlatformActionCode value the gatherer writes. Postgres
-- requires ALTER TYPE ... ADD VALUE to run outside a transaction; Prisma
-- runs each migration file in its own transaction, so this single
-- statement is fine on its own.

ALTER TYPE "PlatformActionCode" ADD VALUE IF NOT EXISTS 'CREDIT_LINE_OVERDUE';
