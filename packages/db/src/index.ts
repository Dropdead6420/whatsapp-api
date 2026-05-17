import { PrismaClient } from "@prisma/client";

declare global {
  var __nexaflow_prisma__: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__nexaflow_prisma__ ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "production"
        ? ["error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__nexaflow_prisma__ = prisma;
}

export * from "@prisma/client";
