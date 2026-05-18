import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __nexaflow_prisma__: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __nexaflow_prisma_ro__: PrismaClient | undefined;
}

// Runtime queries prefer DATABASE_URL_POOLED (PgBouncer, transaction mode)
// when set. Prisma migrate / db push always read DATABASE_URL via the
// schema's `env("DATABASE_URL")`, so migrations still use the direct
// upstream connection — PgBouncer in transaction mode can't proxy the
// session-level features Prisma's migration engine needs.
const runtimeUrl =
  process.env.DATABASE_URL_POOLED?.trim() || process.env.DATABASE_URL;

// Read replica URL (T-101). When set, the `prismaRead` client routes
// SELECT-heavy paths (inbox list, analytics, search) to a read replica
// while keeping writes on the primary `prisma` client. When unset,
// prismaRead is the same instance as prisma — code can use it
// unconditionally without behavior change.
const readReplicaUrl = process.env.DATABASE_URL_READ?.trim();

function buildPrisma(url?: string): PrismaClient {
  return new PrismaClient({
    datasources: url ? { db: { url } } : undefined,
    log:
      process.env.NODE_ENV === "production"
        ? ["error"]
        : ["warn", "error"],
  });
}

export const prisma: PrismaClient =
  global.__nexaflow_prisma__ ?? buildPrisma(runtimeUrl);

export const prismaRead: PrismaClient = readReplicaUrl
  ? global.__nexaflow_prisma_ro__ ?? buildPrisma(readReplicaUrl)
  : prisma;

if (process.env.NODE_ENV !== "production") {
  global.__nexaflow_prisma__ = prisma;
  if (readReplicaUrl) global.__nexaflow_prisma_ro__ = prismaRead;
}

export * from "@prisma/client";
