-- CreateEnum
CREATE TYPE "PricingScope" AS ENUM ('PARTNER', 'SELF');

-- CreateTable
CREATE TABLE "PlanPricingDefault" (
    "id" TEXT NOT NULL,
    "scope" "PricingScope" NOT NULL,
    "planName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "monthlyPaisa" INTEGER NOT NULL DEFAULT 0,
    "quarterlyPaisa" INTEGER NOT NULL DEFAULT 0,
    "yearlyPaisa" INTEGER NOT NULL DEFAULT 0,
    "addLocationMonthlyPaisa" INTEGER NOT NULL DEFAULT 0,
    "addLocationQuarterlyPaisa" INTEGER NOT NULL DEFAULT 0,
    "addLocationYearlyPaisa" INTEGER NOT NULL DEFAULT 0,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanPricingDefault_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanPricingDefault_scope_planName_key" ON "PlanPricingDefault"("scope", "planName");
