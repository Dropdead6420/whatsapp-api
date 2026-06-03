// ============================================================================
// Platform FX rates (Claude Corrected Billing §3 — multi-currency)
//
// A CurrencyRate row says: 1 unit of baseCurrency = rateMicros / 1e6 units
// of quoteCurrency. The rate engine prices a send in the rate row's
// currency, then converts to the customer's wallet currency by multiplying
// the total by the active rate for (rate.currency → wallet.currency). That
// multiply is exactly what calculateWhatsAppQuote already does with
// currencyRateMicros — so convertMicros() here mirrors its rounding.
//
// This service is the independent control plane (model + lookup + CRUD).
// The engine hook that resolves currencyRateMicros from findActiveRate()
// lands with the send-path wiring (see CORRECTED_BILLING_ROLLOUT_PLAN §1).
//
// Pure helpers are exported for unit tests; the prisma layer is thin glue.
// Audit is logged by the route.
// ============================================================================

import { prisma, Prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { normalizeCurrency, toMicros } from "./rateEngine.service";
import { windowsOverlap } from "./rateAdmin.service";

const MICROS_PER_UNIT = 1_000_000n;

export type MicrosInput = bigint | number | string;

export interface CurrencyRateCreateInput {
  baseCurrency: string;
  quoteCurrency: string;
  rateMicros: MicrosInput;
  source?: string | null;
  notes?: string | null;
  effectiveFrom?: Date | string;
  effectiveTo?: Date | string | null;
  isActive?: boolean;
  supersedePrevious?: boolean;
}

export interface CurrencyRateUpdateInput {
  rateMicros?: MicrosInput;
  source?: string | null;
  notes?: string | null;
  effectiveTo?: Date | string | null;
  isActive?: boolean;
}

export interface CurrencyRateListFilter {
  baseCurrency?: string;
  quoteCurrency?: string;
  activeOnly?: boolean;
}

export interface NormalizedCurrencyRate {
  baseCurrency: string;
  quoteCurrency: string;
  rateMicros: bigint;
  source: string | null;
  notes: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "denominator must be positive.");
  }
  if (numerator <= 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Convert an amount in micros from base to quote currency using a rate
 * expressed as quote-per-base micros. Ceil-rounds like the rate engine so
 * the platform never under-charges by a sub-credit fraction.
 */
export function convertMicros(amountMicros: bigint, rateMicros: bigint): bigint {
  if (rateMicros <= 0n) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "rateMicros must be positive.");
  }
  return ceilDiv(amountMicros * rateMicros, MICROS_PER_UNIT);
}

function coerceDate(value: Date | string | null | undefined, label: string): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, `${label} is not a valid date.`);
  }
  return date;
}

/** Validate + normalize a create payload. */
export function normalizeCurrencyRateInput(
  input: CurrencyRateCreateInput,
): NormalizedCurrencyRate {
  const baseCurrency = normalizeCurrency(input.baseCurrency);
  const quoteCurrency = normalizeCurrency(input.quoteCurrency);
  if (baseCurrency === quoteCurrency) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "baseCurrency and quoteCurrency must differ.",
    );
  }

  const rateMicros = toMicros(input.rateMicros);
  if (rateMicros <= 0n) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "rateMicros must be positive.");
  }

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
    baseCurrency,
    quoteCurrency,
    rateMicros,
    source: input.source ?? null,
    notes: input.notes ?? null,
    effectiveFrom,
    effectiveTo,
    isActive: input.isActive ?? true,
  };
}

// ---------------------------------------------------------------------------
// DB layer
// ---------------------------------------------------------------------------

export async function listCurrencyRates(filter: CurrencyRateListFilter = {}) {
  const where: Prisma.CurrencyRateWhereInput = {};
  if (filter.baseCurrency) where.baseCurrency = normalizeCurrency(filter.baseCurrency);
  if (filter.quoteCurrency) where.quoteCurrency = normalizeCurrency(filter.quoteCurrency);
  if (filter.activeOnly) where.isActive = true;

  return prisma.currencyRate.findMany({
    where,
    orderBy: [
      { baseCurrency: "asc" },
      { quoteCurrency: "asc" },
      { effectiveFrom: "desc" },
    ],
    take: 500,
  });
}

export async function getCurrencyRate(id: string) {
  const row = await prisma.currencyRate.findUnique({ where: { id } });
  if (!row) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Currency rate not found.");
  }
  return row;
}

/**
 * The lookup the rate engine will use: newest active rate for a currency
 * pair that is in its effective window at `at`. Returns null when none —
 * an unconfigured pair must surface, never silently assume 1:1.
 */
export async function findActiveCurrencyRate(
  baseCurrency: string,
  quoteCurrency: string,
  at: Date = new Date(),
) {
  const base = normalizeCurrency(baseCurrency);
  const quote = normalizeCurrency(quoteCurrency);
  if (base === quote) return null; // 1:1, no row needed

  return prisma.currencyRate.findFirst({
    where: {
      baseCurrency: base,
      quoteCurrency: quote,
      isActive: true,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

async function findOverlappingActiveRows(candidate: NormalizedCurrencyRate) {
  const siblings = await prisma.currencyRate.findMany({
    where: {
      baseCurrency: candidate.baseCurrency,
      quoteCurrency: candidate.quoteCurrency,
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

export async function createCurrencyRate(
  input: CurrencyRateCreateInput,
  createdByUserId?: string,
) {
  const data = normalizeCurrencyRateInput(input);

  if (data.isActive) {
    const overlapping = await findOverlappingActiveRows(data);
    if (overlapping.length > 0 && !input.supersedePrevious) {
      throw new ApiError(
        ErrorCodes.CONFLICT,
        409,
        `An active rate already covers ${data.baseCurrency}→${data.quoteCurrency} for this period. ` +
          `Deactivate it first, or pass supersedePrevious to close it automatically.`,
      );
    }
    if (overlapping.length > 0) {
      return prisma.$transaction(async (tx) => {
        for (const prior of overlapping) {
          const closesImmediately =
            prior.effectiveFrom.getTime() >= data.effectiveFrom.getTime();
          await tx.currencyRate.update({
            where: { id: prior.id },
            data: closesImmediately
              ? { isActive: false, effectiveTo: data.effectiveFrom }
              : { effectiveTo: data.effectiveFrom },
          });
        }
        return tx.currencyRate.create({ data: { ...data, createdByUserId } });
      });
    }
  }

  return prisma.currencyRate.create({ data: { ...data, createdByUserId } });
}

export async function updateCurrencyRate(id: string, patch: CurrencyRateUpdateInput) {
  const existing = await getCurrencyRate(id);

  const data: Prisma.CurrencyRateUpdateInput = {};
  if (patch.rateMicros !== undefined) {
    const rateMicros = toMicros(patch.rateMicros);
    if (rateMicros <= 0n) {
      throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "rateMicros must be positive.");
    }
    data.rateMicros = rateMicros;
  }
  if (patch.source !== undefined) data.source = patch.source;
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

  return prisma.currencyRate.update({ where: { id }, data });
}

export async function deactivateCurrencyRate(id: string) {
  await getCurrencyRate(id);
  return prisma.currencyRate.update({
    where: { id },
    data: { isActive: false, effectiveTo: new Date() },
  });
}

/** Serialize BigInt rateMicros to a string for JSON responses. */
export function serializeCurrencyRate<T extends { rateMicros: bigint }>(row: T) {
  return { ...row, rateMicros: row.rateMicros.toString() };
}
