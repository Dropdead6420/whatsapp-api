import { PrismaClient } from "@prisma/client";

declare global {
  var __nexaflow_prisma__: PrismaClient | undefined;
}

// Runtime queries prefer DATABASE_URL_POOLED (PgBouncer, transaction mode)
// when set. Prisma migrate / db push always read DATABASE_URL via the
// schema's `env("DATABASE_URL")`, so migrations still use the direct
// upstream connection — PgBouncer in transaction mode can't proxy the
// session-level features Prisma's migration engine needs.
const runtimeUrl =
  process.env.DATABASE_URL_POOLED?.trim() || process.env.DATABASE_URL;

export const prisma: PrismaClient =
  global.__nexaflow_prisma__ ??
  new PrismaClient({
    datasources: runtimeUrl ? { db: { url: runtimeUrl } } : undefined,
    log:
      process.env.NODE_ENV === "production"
        ? ["error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__nexaflow_prisma__ = prisma;
}

export * from "@prisma/client";
