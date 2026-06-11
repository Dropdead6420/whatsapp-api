import { prisma, PricingScope } from "@nexaflow/db";

// =====================================================================
// SuperAdmin "Manage Defaults" — default subscription pricing matrix.
// Per scope (PARTNER vs SELF), a free-form set of plans with monthly /
// quarterly / yearly prices plus per-add-location prices, all in paise. No
// hardcoded plan catalog — rows are admin-managed. Pure normalization is
// separated from the DB upsert so it can be unit-tested.
// =====================================================================

export interface PricingDefaultInput {
  planName: string;
  sortOrder?: number;
  monthlyPaisa?: number;
  quarterlyPaisa?: number;
  yearlyPaisa?: number;
  addLocationMonthlyPaisa?: number;
  addLocationQuarterlyPaisa?: number;
  addLocationYearlyPaisa?: number;
}

/** Clamp any input to a non-negative whole number of paise (pure). */
export function sanitizePaisa(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Normalize a raw pricing row: trimmed name + clamped non-negative prices. */
export function normalizePricingInput(input: PricingDefaultInput) {
  const sortOrder = Math.floor(Number(input.sortOrder));
  return {
    planName: input.planName.trim(),
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    monthlyPaisa: sanitizePaisa(input.monthlyPaisa),
    quarterlyPaisa: sanitizePaisa(input.quarterlyPaisa),
    yearlyPaisa: sanitizePaisa(input.yearlyPaisa),
    addLocationMonthlyPaisa: sanitizePaisa(input.addLocationMonthlyPaisa),
    addLocationQuarterlyPaisa: sanitizePaisa(input.addLocationQuarterlyPaisa),
    addLocationYearlyPaisa: sanitizePaisa(input.addLocationYearlyPaisa),
  };
}

/** Default pricing rows for a scope, ordered for display. */
export async function listPricingDefaults(scope: PricingScope) {
  return prisma.planPricingDefault.findMany({
    where: { scope },
    orderBy: [{ sortOrder: "asc" }, { planName: "asc" }],
  });
}

/**
 * Upsert a batch of pricing rows for a scope (keyed by scope + plan name).
 * Blank plan names are skipped. Returns the saved rows.
 */
export async function upsertPricingDefaults(
  scope: PricingScope,
  rows: PricingDefaultInput[],
  updatedByUserId?: string,
) {
  const saved = [];
  for (const raw of rows) {
    const data = normalizePricingInput(raw);
    if (!data.planName) continue;
    saved.push(
      await prisma.planPricingDefault.upsert({
        where: { scope_planName: { scope, planName: data.planName } },
        create: { scope, ...data, updatedByUserId: updatedByUserId ?? null },
        update: { ...data, updatedByUserId: updatedByUserId ?? null },
      }),
    );
  }
  return saved;
}
