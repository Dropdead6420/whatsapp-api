import crypto from "node:crypto";
import {
  prisma,
  UsageEventKind,
  UsageEventStatus,
  WhatsAppProviderKey,
  WhatsAppUsageCategory,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

const MICROS_PER_UNIT = 1_000_000n;
const BPS_DENOMINATOR = 10_000n;
const DEFAULT_COUNTRY_CODE = "DEFAULT";
const DEFAULT_WALLET_CURRENCY = "INR";

type MicrosInput = bigint | number | string;

export interface WhatsAppRateRowLike {
  id: string;
  countryCode: string;
  category: WhatsAppUsageCategory;
  providerKey: WhatsAppProviderKey;
  currency: string;
  baseCostMicros: MicrosInput;
  providerCostMicros?: MicrosInput | null;
  taxBps?: number | null;
  gatewayFeeBps?: number | null;
}

export interface PartnerRateRuleLike {
  id?: string;
  partnerTenantId?: string;
  customerTenantId?: string | null;
  countryCode?: string | null;
  category?: WhatsAppUsageCategory | null;
  providerKey?: WhatsAppProviderKey | null;
  markupBps?: number | null;
  fixedMarkupMicros?: MicrosInput | null;
  priority?: number | null;
}

export interface WhatsAppQuoteInput {
  rate: WhatsAppRateRowLike;
  partnerRule?: PartnerRateRuleLike | null;
  units?: number;
  walletCurrency?: string;
  currencyRateMicros?: MicrosInput;
  creditUnitMicros?: MicrosInput;
}

export interface WhatsAppRateQuote {
  rateTableId: string;
  partnerRateRuleId: string | null;
  countryCode: string;
  category: WhatsAppUsageCategory;
  providerKey: WhatsAppProviderKey;
  units: number;
  rateCurrency: string;
  walletCurrency: string;
  currencyRateMicros: bigint;
  creditUnitMicros: bigint;
  baseCostMicros: bigint;
  providerCostMicros: bigint;
  partnerMarkupBps: number;
  partnerMarkupMicros: bigint;
  taxBps: number;
  gatewayFeeBps: number;
  subtotalMicros: bigint;
  taxMicros: bigint;
  gatewayFeeMicros: bigint;
  totalCostMicros: bigint;
  walletCostMicros: bigint;
  walletDebitCredits: number;
}

export interface QuoteWhatsAppUsageInput {
  tenantId: string;
  countryCode: string;
  category: WhatsAppUsageCategory;
  providerKey: WhatsAppProviderKey;
  units?: number;
  partnerTenantId?: string | null;
  customerTenantId?: string | null;
  source?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  content?: string | null;
  contentHash?: string | null;
  idempotencyKey?: string | null;
  walletCurrency?: string;
  currencyRateMicros?: MicrosInput;
  creditUnitMicros?: MicrosInput;
  persist?: boolean;
  now?: Date;
}

export function normalizeCountryCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (normalized === DEFAULT_COUNTRY_CODE) return DEFAULT_COUNTRY_CODE;
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "countryCode must be a 2-letter ISO country code.",
    );
  }
  return normalized;
}

export function normalizeCurrency(value: string | undefined): string {
  const normalized = (value ?? DEFAULT_WALLET_CURRENCY).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Currency must be a 3-letter ISO code.",
    );
  }
  return normalized;
}

export function toMicros(value: MicrosInput): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Micros must be an integer.");
    }
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value.trim())) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Micros must be an integer.");
  }
  return BigInt(value);
}

function assertNonNegativeMicros(value: bigint, label: string): void {
  if (value < 0n) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, `${label} cannot be negative.`);
  }
}

function assertBps(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 100_000) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `${label} must be an integer between 0 and 100000 bps.`,
    );
  }
  return value;
}

function assertPositiveUnits(units: number | undefined): number {
  const normalized = units ?? 1;
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "units must be a positive integer.");
  }
  return normalized;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "denominator must be positive.");
  }
  if (numerator <= 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

export function applyBpsCeil(amountMicros: bigint, bps: number): bigint {
  const safeBps = assertBps(bps, "bps");
  return ceilDiv(amountMicros * BigInt(safeBps), BPS_DENOMINATOR);
}

function creditsFromWalletMicros(walletCostMicros: bigint, creditUnitMicros: bigint): number {
  const credits = ceilDiv(walletCostMicros, creditUnitMicros);
  const asNumber = Number(credits);
  if (!Number.isSafeInteger(asNumber) || asNumber > 2_147_483_647) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Quoted usage is too large for one wallet debit. Split it into smaller batches.",
    );
  }
  return asNumber;
}

export function calculateWhatsAppQuote(input: WhatsAppQuoteInput): WhatsAppRateQuote {
  const units = assertPositiveUnits(input.units);
  const baseCostMicros = toMicros(input.rate.baseCostMicros);
  const providerCostMicros = toMicros(input.rate.providerCostMicros ?? 0);
  const fixedMarkupMicros = toMicros(input.partnerRule?.fixedMarkupMicros ?? 0);
  const currencyRateMicros = toMicros(input.currencyRateMicros ?? MICROS_PER_UNIT);
  const creditUnitMicros = toMicros(input.creditUnitMicros ?? MICROS_PER_UNIT);

  assertNonNegativeMicros(baseCostMicros, "baseCostMicros");
  assertNonNegativeMicros(providerCostMicros, "providerCostMicros");
  assertNonNegativeMicros(fixedMarkupMicros, "fixedMarkupMicros");
  assertNonNegativeMicros(currencyRateMicros, "currencyRateMicros");
  assertNonNegativeMicros(creditUnitMicros, "creditUnitMicros");

  const partnerMarkupBps = assertBps(input.partnerRule?.markupBps ?? 0, "markupBps");
  const taxBps = assertBps(input.rate.taxBps ?? 0, "taxBps");
  const gatewayFeeBps = assertBps(input.rate.gatewayFeeBps ?? 0, "gatewayFeeBps");

  const perUnitCostMicros = baseCostMicros + providerCostMicros;
  const usageCostMicros = perUnitCostMicros * BigInt(units);
  const variableMarkupMicros = applyBpsCeil(usageCostMicros, partnerMarkupBps);
  const partnerMarkupMicros =
    variableMarkupMicros + fixedMarkupMicros * BigInt(units);
  const subtotalMicros = usageCostMicros + partnerMarkupMicros;
  const taxMicros = applyBpsCeil(subtotalMicros, taxBps);
  const gatewayFeeMicros = applyBpsCeil(subtotalMicros, gatewayFeeBps);
  const totalCostMicros = subtotalMicros + taxMicros + gatewayFeeMicros;
  const walletCostMicros = ceilDiv(totalCostMicros * currencyRateMicros, MICROS_PER_UNIT);

  return {
    rateTableId: input.rate.id,
    partnerRateRuleId: input.partnerRule?.id ?? null,
    countryCode: input.rate.countryCode,
    category: input.rate.category,
    providerKey: input.rate.providerKey,
    units,
    rateCurrency: normalizeCurrency(input.rate.currency),
    walletCurrency: normalizeCurrency(input.walletCurrency ?? input.rate.currency),
    currencyRateMicros,
    creditUnitMicros,
    baseCostMicros,
    providerCostMicros,
    partnerMarkupBps,
    partnerMarkupMicros,
    taxBps,
    gatewayFeeBps,
    subtotalMicros,
    taxMicros,
    gatewayFeeMicros,
    totalCostMicros,
    walletCostMicros,
    walletDebitCredits: creditsFromWalletMicros(walletCostMicros, creditUnitMicros),
  };
}

function hashContent(content: string | null | undefined): string | null {
  const normalized = content?.trim();
  if (!normalized) return null;
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function buildIdempotencyKey(input: QuoteWhatsAppUsageInput, contentHash: string | null): string {
  const explicit = input.idempotencyKey?.trim();
  if (explicit) return explicit;

  const stable = [
    "whatsapp",
    input.tenantId,
    input.source ?? "unknown",
    input.referenceType ?? "none",
    input.referenceId ?? "none",
    normalizeCountryCode(input.countryCode),
    input.category,
    input.providerKey,
    input.units ?? 1,
    contentHash ?? "no-content",
  ].join(":");

  return crypto.createHash("sha256").update(stable).digest("hex");
}

function activeWindowWhere(now: Date) {
  return {
    effectiveFrom: { lte: now },
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
  };
}

async function findActiveWhatsAppRate(input: {
  countryCode: string;
  category: WhatsAppUsageCategory;
  providerKey: WhatsAppProviderKey;
  now: Date;
}) {
  const baseWhere = {
    category: input.category,
    providerKey: input.providerKey,
    isActive: true,
    ...activeWindowWhere(input.now),
  };

  const exact = await prisma.whatsAppRateTable.findFirst({
    where: { ...baseWhere, countryCode: input.countryCode },
    orderBy: { effectiveFrom: "desc" },
  });
  if (exact) return exact;

  return prisma.whatsAppRateTable.findFirst({
    where: { ...baseWhere, countryCode: DEFAULT_COUNTRY_CODE },
    orderBy: { effectiveFrom: "desc" },
  });
}

function partnerRuleSpecificity(rule: PartnerRateRuleLike): number {
  return [
    rule.customerTenantId,
    rule.countryCode,
    rule.category,
    rule.providerKey,
  ].filter(Boolean).length;
}

async function findActivePartnerRateRule(input: {
  partnerTenantId?: string | null;
  customerTenantId?: string | null;
  countryCode: string;
  category: WhatsAppUsageCategory;
  providerKey: WhatsAppProviderKey;
  now: Date;
}) {
  if (!input.partnerTenantId) return null;

  const rows = await prisma.partnerRateRule.findMany({
    where: {
      partnerTenantId: input.partnerTenantId,
      isActive: true,
      ...activeWindowWhere(input.now),
      AND: [
        {
          OR: [
            { customerTenantId: input.customerTenantId ?? undefined },
            { customerTenantId: null },
          ],
        },
        {
          OR: [{ countryCode: input.countryCode }, { countryCode: null }],
        },
        {
          OR: [{ category: input.category }, { category: null }],
        },
        {
          OR: [{ providerKey: input.providerKey }, { providerKey: null }],
        },
      ],
    },
    orderBy: [{ priority: "asc" }, { effectiveFrom: "desc" }],
    take: 25,
  });

  return rows.sort((a, b) => {
    const priorityDiff = (a.priority ?? 100) - (b.priority ?? 100);
    if (priorityDiff !== 0) return priorityDiff;
    return partnerRuleSpecificity(b) - partnerRuleSpecificity(a);
  })[0] ?? null;
}

export async function quoteWhatsAppUsage(input: QuoteWhatsAppUsageInput) {
  const now = input.now ?? new Date();
  const countryCode = normalizeCountryCode(input.countryCode);
  const units = assertPositiveUnits(input.units);
  const contentHash = input.contentHash ?? hashContent(input.content);
  const idempotencyKey = buildIdempotencyKey(input, contentHash);

  if (input.persist) {
    const existing = await prisma.usageEvent.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey } },
    });
    if (existing) {
      return {
        quote: null,
        usageEvent: existing,
        idempotent: true as const,
      };
    }
  }

  const rate = await findActiveWhatsAppRate({
    countryCode,
    category: input.category,
    providerKey: input.providerKey,
    now,
  });
  if (!rate) {
    throw new ApiError(
      ErrorCodes.NOT_FOUND,
      404,
      `No active WhatsApp rate found for ${countryCode}/${input.category}/${input.providerKey}.`,
    );
  }

  const partnerRule = await findActivePartnerRateRule({
    partnerTenantId: input.partnerTenantId,
    customerTenantId: input.customerTenantId ?? input.tenantId,
    countryCode,
    category: input.category,
    providerKey: input.providerKey,
    now,
  });

  const quote = calculateWhatsAppQuote({
    rate,
    partnerRule,
    units,
    walletCurrency: input.walletCurrency,
    currencyRateMicros: input.currencyRateMicros,
    creditUnitMicros: input.creditUnitMicros,
  });

  if (!input.persist) {
    return { quote, usageEvent: null, idempotent: false as const };
  }

  const usageEvent = await prisma.usageEvent.create({
    data: {
      tenantId: input.tenantId,
      partnerTenantId: input.partnerTenantId ?? null,
      kind: UsageEventKind.WHATSAPP_MESSAGE,
      status: UsageEventStatus.QUOTED,
      idempotencyKey,
      providerKey: input.providerKey,
      countryCode,
      category: input.category,
      units,
      source: input.source ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      contentHash,
      rateTableId: quote.rateTableId,
      currency: quote.rateCurrency,
      baseCostMicros: quote.baseCostMicros,
      providerCostMicros: quote.providerCostMicros,
      partnerMarkupBps: quote.partnerMarkupBps,
      partnerMarkupMicros: quote.partnerMarkupMicros,
      taxBps: quote.taxBps,
      gatewayFeeBps: quote.gatewayFeeBps,
      subtotalMicros: quote.subtotalMicros,
      taxMicros: quote.taxMicros,
      gatewayFeeMicros: quote.gatewayFeeMicros,
      totalCostMicros: quote.totalCostMicros,
      walletCurrency: quote.walletCurrency,
      currencyRateMicros: quote.currencyRateMicros,
      walletCostMicros: quote.walletCostMicros,
      walletDebitCredits: quote.walletDebitCredits,
      metadata: JSON.stringify({
        partnerRateRuleId: quote.partnerRateRuleId,
        creditUnitMicros: quote.creditUnitMicros.toString(),
      }),
    },
  });

  return { quote, usageEvent, idempotent: false as const };
}
