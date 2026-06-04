import { prisma, TenantType, type Prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { normalizeCurrency } from "./rateEngine.service";

export const LAUNCH_CURRENCIES = [
  { code: "INR", name: "Indian Rupee", symbol: "₹", minorUnit: 2, displayOrder: 10 },
  { code: "USD", name: "US Dollar", symbol: "$", minorUnit: 2, displayOrder: 20 },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$", minorUnit: 2, displayOrder: 30 },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", minorUnit: 2, displayOrder: 40 },
  { code: "GBP", name: "British Pound", symbol: "£", minorUnit: 2, displayOrder: 50 },
  { code: "EUR", name: "Euro", symbol: "€", minorUnit: 2, displayOrder: 60 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", minorUnit: 2, displayOrder: 70 },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", minorUnit: 2, displayOrder: 80 },
] as const;

export interface CurrencyUpsertInput {
  code: string;
  name: string;
  symbol: string;
  minorUnit?: number;
  isActive?: boolean;
  isLaunchCurrency?: boolean;
  displayOrder?: number;
}

export interface CustomerCurrencySettingInput {
  tenantId: string;
  currencyCode: string;
  locale?: string;
  showConvertedAmounts?: boolean;
  createdByUserId?: string;
}

export interface PartnerCurrencySettingInput {
  partnerTenantId: string;
  defaultCurrencyCode: string;
  settlementCurrencyCode?: string;
  allowedCurrencies?: string[];
  passThroughCustomerCurrency?: boolean;
  createdByUserId?: string;
}

function assertMinorUnit(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 8) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "minorUnit must be an integer between 0 and 8.",
    );
  }
  return value;
}

function assertDisplayOrder(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "displayOrder must be an integer between 0 and 10000.",
    );
  }
  return value;
}

export function normalizeCurrencyCodes(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const code of codes) {
    seen.add(normalizeCurrency(code));
  }
  return [...seen].sort();
}

export function normalizeCurrencyUpsertInput(input: CurrencyUpsertInput) {
  const code = normalizeCurrency(input.code);
  const name = input.name.trim();
  const symbol = input.symbol.trim();
  if (!name) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Currency name is required.");
  }
  if (!symbol) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Currency symbol is required.");
  }
  return {
    code,
    name,
    symbol,
    minorUnit: assertMinorUnit(input.minorUnit ?? 2),
    isActive: input.isActive ?? true,
    isLaunchCurrency: input.isLaunchCurrency ?? false,
    displayOrder: assertDisplayOrder(input.displayOrder ?? 100),
  };
}

async function assertCurrencyActive(code: string) {
  const normalized = normalizeCurrency(code);
  const currency = await prisma.currency.findUnique({ where: { code: normalized } });
  if (!currency || !currency.isActive) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Currency ${normalized} is not active.`,
    );
  }
  return currency;
}

async function assertTenant(id: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: { id: true, type: true, parentTenantId: true },
  });
  if (!tenant) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Customer not found.");
  }
  return tenant;
}

export async function listCurrencies(args: { activeOnly?: boolean } = {}) {
  return prisma.currency.findMany({
    where: args.activeOnly ? { isActive: true } : {},
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  });
}

export async function upsertCurrency(input: CurrencyUpsertInput) {
  const data = normalizeCurrencyUpsertInput(input);
  return prisma.currency.upsert({
    where: { code: data.code },
    update: data,
    create: data,
  });
}

export async function ensureLaunchCurrencies() {
  for (const currency of LAUNCH_CURRENCIES) {
    await upsertCurrency({
      ...currency,
      isActive: true,
      isLaunchCurrency: true,
    });
  }
}

export async function getCustomerCurrencySetting(tenantId: string) {
  await assertTenant(tenantId);
  const existing = await prisma.customerCurrencySetting.findUnique({
    where: { tenantId },
  });
  if (existing) return existing;
  return prisma.customerCurrencySetting.create({
    data: { tenantId, currencyCode: "INR", locale: "en-IN" },
  });
}

export async function setCustomerCurrencySetting(
  input: CustomerCurrencySettingInput,
) {
  const tenant = await assertTenant(input.tenantId);
  if (tenant.type === TenantType.WHITE_LABEL) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Use partner currency settings for white-label partners.",
    );
  }
  const currency = await assertCurrencyActive(input.currencyCode);
  const locale = input.locale?.trim() || "en-IN";

  return prisma.customerCurrencySetting.upsert({
    where: { tenantId: input.tenantId },
    update: {
      currencyCode: currency.code,
      locale,
      showConvertedAmounts: input.showConvertedAmounts,
      createdByUserId: input.createdByUserId,
    },
    create: {
      tenantId: input.tenantId,
      currencyCode: currency.code,
      locale,
      showConvertedAmounts: input.showConvertedAmounts ?? true,
      createdByUserId: input.createdByUserId,
    },
  });
}

export async function getPartnerCurrencySetting(partnerTenantId: string) {
  const tenant = await assertTenant(partnerTenantId);
  if (tenant.type !== TenantType.WHITE_LABEL) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Partner currency settings require a white-label partner.",
    );
  }
  const existing = await prisma.partnerCurrencySetting.findUnique({
    where: { partnerTenantId },
  });
  if (existing) return existing;
  return prisma.partnerCurrencySetting.create({
    data: {
      partnerTenantId,
      defaultCurrencyCode: "INR",
      settlementCurrencyCode: "INR",
      allowedCurrencies: ["INR"],
    },
  });
}

export async function setPartnerCurrencySetting(
  input: PartnerCurrencySettingInput,
) {
  const tenant = await assertTenant(input.partnerTenantId);
  if (tenant.type !== TenantType.WHITE_LABEL) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Partner currency settings require a white-label partner.",
    );
  }

  const defaultCurrency = await assertCurrencyActive(input.defaultCurrencyCode);
  const settlementCurrency = await assertCurrencyActive(
    input.settlementCurrencyCode ?? defaultCurrency.code,
  );
  const allowed = normalizeCurrencyCodes(
    input.allowedCurrencies?.length
      ? input.allowedCurrencies
      : [defaultCurrency.code, settlementCurrency.code],
  );
  for (const code of allowed) {
    await assertCurrencyActive(code);
  }

  const allowedJson = allowed as unknown as Prisma.InputJsonValue;
  return prisma.partnerCurrencySetting.upsert({
    where: { partnerTenantId: input.partnerTenantId },
    update: {
      defaultCurrencyCode: defaultCurrency.code,
      settlementCurrencyCode: settlementCurrency.code,
      allowedCurrencies: allowedJson,
      passThroughCustomerCurrency: input.passThroughCustomerCurrency,
      createdByUserId: input.createdByUserId,
    },
    create: {
      partnerTenantId: input.partnerTenantId,
      defaultCurrencyCode: defaultCurrency.code,
      settlementCurrencyCode: settlementCurrency.code,
      allowedCurrencies: allowedJson,
      passThroughCustomerCurrency: input.passThroughCustomerCurrency ?? true,
      createdByUserId: input.createdByUserId,
    },
  });
}
