// ============================================================================
// SuperAdmin WhatsApp rate-table control (Claude Corrected Billing §3)
//
// The rate engine (rateEngine.service) reads WhatsAppRateTable to price
// every chargeable WhatsApp send. Until now rows could only be seeded by
// raw SQL. This service is the SuperAdmin control plane: validated CRUD +
// effective-dating + an overlap guard so the engine never sees two active
// rows competing for the same (country, category, provider) window.
//
// Selection contract we must honour (see rateEngine.findActiveWhatsAppRate):
//   active row  ⇔  isActive = true
//                  AND effectiveFrom <= now
//                  AND (effectiveTo IS NULL OR effectiveTo > now)
//   among matches for (countryCode, category, providerKey) the newest
//   effectiveFrom wins; countryCode falls back to "DEFAULT".
//
// So two overlapping active rows for the same tuple silently shadow each
// other — exactly the data-entry mistake createRate() refuses to make.
//
// Pure helpers (validation, normalization, overlap math) are exported for
// unit tests; the prisma layer is thin glue. Audit is logged by the route.
// ============================================================================

import {
  prisma,
  Prisma,
  WhatsAppProviderKey,
  WhatsAppUsageCategory,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import {
  normalizeCountryCode,
  normalizeCurrency,
  toMicros,
} from "./rateEngine.service";

const MAX_BPS = 100_000;

export type MicrosInput = bigint | number | string;

export interface RateCreateInput {
  countryCode: string;
  category: WhatsAppUsageCategory;
  providerKey: WhatsAppProviderKey;
  currency?: string;
  baseCostMicros: MicrosInput;
  providerCostMicros?: MicrosInput;
  taxBps?: number;
  gatewayFeeBps?: number;
  effectiveFrom?: Date | string;
  effectiveTo?: Date | string | null;
  notes?: string | null;
  isActive?: boolean;
  /** Close any overlapping active row instead of rejecting the create. */
  supersedePrevious?: boolean;
}

export interface RateUpdateInput {
  currency?: string;
  baseCostMicros?: MicrosInput;
  providerCostMicros?: MicrosInput;
  taxBps?: number;
  gatewayFeeBps?: number;
  effectiveTo?: Date | string | null;
  notes?: string | null;
  isActive?: boolean;
}

export interface RateListFilter {
  countryCode?: string;
  category?: WhatsAppUsageCategory;
  providerKey?: WhatsAppProviderKey;
  currency?: string;
  activeOnly?: boolean;
}

export interface NormalizedRate {
  countryCode: string;
  category: WhatsAppUsageCategory;
  providerKey: WhatsAppProviderKey;
  currency: string;
  baseCostMicros: bigint;
  providerCostMicros: bigint;
  taxBps: number;
  gatewayFeeBps: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  notes: string | null;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Basis-points must be an integer in [0, 100000] — mirrors the engine. */
export function assertRateBps(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_BPS) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `${label} must be an integer between 0 and ${MAX_BPS} bps.`,
    );
  }
  return value;
}

function assertNonNegativeMicros(value: bigint, label: string): bigint {
  if (value < 0n) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, `${label} cannot be negative.`);
  }
  return value;
}

function coerceDate(value: Date | string | null | undefined, label: string): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, `${label} is not a valid date.`);
  }
  return date;
}

/**
 * Half-open [from, to) overlap test; a null `to` means "open-ended"
 * (effective forever). Two rows overlap when each starts before the
 * other ends.
 */
export function windowsOverlap(
  aFrom: Date,
  aTo: Date | null,
  bFrom: Date,
  bTo: Date | null,
): boolean {
  const aEnd = aTo ? aTo.getTime() : Number.POSITIVE_INFINITY;
  const bEnd = bTo ? bTo.getTime() : Number.POSITIVE_INFINITY;
  return aFrom.getTime() < bEnd && bFrom.getTime() < aEnd;
}

/** Validate + normalize a create payload into engine-compatible shapes. */
export function normalizeRateInput(input: RateCreateInput): NormalizedRate {
  const baseCostMicros = assertNonNegativeMicros(
    toMicros(input.baseCostMicros),
    "baseCostMicros",
  );
  const providerCostMicros = assertNonNegativeMicros(
    toMicros(input.providerCostMicros ?? 0),
    "providerCostMicros",
  );
  const taxBps = assertRateBps(input.taxBps ?? 0, "taxBps");
  const gatewayFeeBps = assertRateBps(input.gatewayFeeBps ?? 0, "gatewayFeeBps");

  const effectiveFrom = coerceDate(input.effectiveFrom, "effectiveFrom") ?? new Date();
  const effectiveTo = coerceDate(input.effectiveTo ?? null, "effectiveTo");
  if (effectiveTo && effectiveTo.getTime() <= effectiveFrom.getTime()) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "effectiveTo must be after effectiveFrom.",
    );
  }

  return {
    countryCode: normalizeCountryCode(input.countryCode),
    category: input.category,
    providerKey: input.providerKey,
    currency: normalizeCurrency(input.currency),
    baseCostMicros,
    providerCostMicros,
    taxBps,
    gatewayFeeBps,
    effectiveFrom,
    effectiveTo,
    notes: input.notes ?? null,
    isActive: input.isActive ?? true,
  };
}

// ---------------------------------------------------------------------------
// DB layer (thin glue; audit logged by the route)
// ---------------------------------------------------------------------------

export async function listRates(filter: RateListFilter = {}) {
  const where: Prisma.WhatsAppRateTableWhereInput = {};
  if (filter.countryCode) where.countryCode = normalizeCountryCode(filter.countryCode);
  if (filter.category) where.category = filter.category;
  if (filter.providerKey) where.providerKey = filter.providerKey;
  if (filter.currency) where.currency = normalizeCurrency(filter.currency);
  if (filter.activeOnly) where.isActive = true;

  return prisma.whatsAppRateTable.findMany({
    where,
    orderBy: [
      { countryCode: "asc" },
      { category: "asc" },
      { providerKey: "asc" },
      { effectiveFrom: "desc" },
    ],
    take: 500,
  });
}

export async function getRate(id: string) {
  const row = await prisma.whatsAppRateTable.findUnique({ where: { id } });
  if (!row) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Rate not found.");
  }
  return row;
}

/**
 * Find active rows that would compete with `candidate` for the same
 * (country, category, provider) selection window. Returns the rows that
 * overlap — empty when the new row is unambiguous.
 */
async function findOverlappingActiveRows(candidate: NormalizedRate) {
  const siblings = await prisma.whatsAppRateTable.findMany({
    where: {
      countryCode: candidate.countryCode,
      category: candidate.category,
      providerKey: candidate.providerKey,
      isActive: true,
    },
  });
  return siblings.filter((row) =>
    windowsOverlap(
      candidate.effectiveFrom,
      candidate.effectiveTo,
      row.effectiveFrom,
      row.effectiveTo,
    ),
  );
}

export async function createRate(input: RateCreateInput, createdByUserId?: string) {
  const data = normalizeRateInput(input);

  // Only an *active* new row can shadow another; an inactive draft can't.
  if (data.isActive) {
    const overlapping = await findOverlappingActiveRows(data);
    if (overlapping.length > 0 && !input.supersedePrevious) {
      throw new ApiError(
        ErrorCodes.CONFLICT,
        409,
        `An active rate already covers ${data.countryCode}/${data.category}/${data.providerKey} for this period. ` +
          `Deactivate it first, or pass supersedePrevious to close it automatically.`,
      );
    }

    if (overlapping.length > 0) {
      // Supersede: close each prior active row at the new row's start.
      return prisma.$transaction(async (tx) => {
        for (const prior of overlapping) {
          const closesImmediately =
            prior.effectiveFrom.getTime() >= data.effectiveFrom.getTime();
          await tx.whatsAppRateTable.update({
            where: { id: prior.id },
            data: closesImmediately
              ? { isActive: false, effectiveTo: data.effectiveFrom }
              : { effectiveTo: data.effectiveFrom },
          });
        }
        return tx.whatsAppRateTable.create({ data: { ...data, createdByUserId } });
      });
    }
  }

  return prisma.whatsAppRateTable.create({ data: { ...data, createdByUserId } });
}

export async function updateRate(id: string, patch: RateUpdateInput) {
  const existing = await getRate(id);

  const data: Prisma.WhatsAppRateTableUpdateInput = {};
  if (patch.currency !== undefined) data.currency = normalizeCurrency(patch.currency);
  if (patch.baseCostMicros !== undefined) {
    data.baseCostMicros = assertNonNegativeMicros(
      toMicros(patch.baseCostMicros),
      "baseCostMicros",
    );
  }
  if (patch.providerCostMicros !== undefined) {
    data.providerCostMicros = assertNonNegativeMicros(
      toMicros(patch.providerCostMicros),
      "providerCostMicros",
    );
  }
  if (patch.taxBps !== undefined) data.taxBps = assertRateBps(patch.taxBps, "taxBps");
  if (patch.gatewayFeeBps !== undefined) {
    data.gatewayFeeBps = assertRateBps(patch.gatewayFeeBps, "gatewayFeeBps");
  }
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  if (patch.effectiveTo !== undefined) {
    const effectiveTo = coerceDate(patch.effectiveTo, "effectiveTo");
    if (effectiveTo && effectiveTo.getTime() <= existing.effectiveFrom.getTime()) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        "effectiveTo must be after effectiveFrom.",
      );
    }
    data.effectiveTo = effectiveTo;
  }

  return prisma.whatsAppRateTable.update({ where: { id }, data });
}

/** Soft-retire a rate: deactivate and close its window now. */
export async function deactivateRate(id: string) {
  await getRate(id);
  return prisma.whatsAppRateTable.update({
    where: { id },
    data: { isActive: false, effectiveTo: new Date() },
  });
}

/** Serialize a rate row's BigInt micros to strings for JSON responses. */
export function serializeRate<
  T extends { baseCostMicros: bigint; providerCostMicros: bigint },
>(row: T) {
  return {
    ...row,
    baseCostMicros: row.baseCostMicros.toString(),
    providerCostMicros: row.providerCostMicros.toString(),
  };
}
