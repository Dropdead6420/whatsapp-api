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

export interface TenantCurrencyContext {
  setting: {
    tenantId: string;
    currencyCode: string;
    locale: string;
    symbol: string;
    minorUnit: number;
    showConvertedAmounts: boolean;
    canUpdatePreference: boolean;
  };
  policy: {
    source: "customer" | "partner" | "platform";
    defaultCurrencyCode: string;
    settlementCurrencyCode: string;
    allowedCurrencies: string[];
    passThroughCustomerCurrency: boolean;
  };
  currencies: Array<{
    code: string;
    name: string;
    symbol: string;
    minorUnit: number;
    isLaunchCurrency: boolean;
  }>;
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

export function defaultLocaleForCurrency(input: string): string {
  const code = normalizeCurrency(input);
  const localeByCurrency: Record<string, string> = {
    AED: "en-AE",
    AUD: "en-AU",
    CAD: "en-CA",
    EUR: "en",
    GBP: "en-GB",
    INR: "en-IN",
    SGD: "en-SG",
    USD: "en-US",
  };
  return localeByCurrency[code] ?? "en";
}

function jsonCurrencyCodes(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((code): code is string => typeof code === "string");
}

export function resolveAllowedCurrencyCodes(args: {
  allowedCurrencies: readonly string[];
  activeCurrencyCodes: readonly string[];
  defaultCurrencyCode: string;
}): string[] {
  const active = new Set(normalizeCurrencyCodes(args.activeCurrencyCodes));
  const normalizedAllowed = normalizeCurrencyCodes(args.allowedCurrencies);
  const allowed = normalizedAllowed.filter((code) => active.has(code));
  if (allowed.length) return allowed;
  const fallbackDefault = normalizeCurrency(args.defaultCurrencyCode);
  if (active.has(fallbackDefault)) return [fallbackDefault];
  return active.has("INR") ? ["INR"] : [...active].slice(0, 1);
}

export function resolveCurrencyPreference(args: {
  requestedCurrencyCode?: string | null;
  defaultCurrencyCode: string;
  allowedCurrencies: readonly string[];
}): string {
  const allowed = new Set(normalizeCurrencyCodes(args.allowedCurrencies));
  const requested = args.requestedCurrencyCode
    ? normalizeCurrency(args.requestedCurrencyCode)
    : null;
  if (requested && allowed.has(requested)) return requested;
  const defaultCurrencyCode = normalizeCurrency(args.defaultCurrencyCode);
  if (allowed.has(defaultCurrencyCode)) return defaultCurrencyCode;
  return args.allowedCurrencies[0]
    ? normalizeCurrency(args.allowedCurrencies[0])
    : defaultCurrencyCode;
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

function currencyRowsForAllowedCodes(
  currencies: Awaited<ReturnType<typeof listCurrencies>>,
  allowedCodes: string[],
) {
  const allowed = new Set(allowedCodes);
  return currencies
    .filter((currency) => allowed.has(currency.code))
    .map((currency) => ({
      code: currency.code,
      name: currency.name,
      symbol: currency.symbol,
      minorUnit: currency.minorUnit,
      isLaunchCurrency: currency.isLaunchCurrency,
    }));
}

export async function getTenantCurrencyContext(
  tenantId: string,
): Promise<TenantCurrencyContext> {
  const tenant = await assertTenant(tenantId);
  const activeCurrencies = await listCurrencies({ activeOnly: true });
  const activeCodes = activeCurrencies.map((currency) => currency.code);
  let allowedCurrencies = activeCodes;
  let defaultCurrencyCode = "INR";
  let settlementCurrencyCode = "INR";
  let passThroughCustomerCurrency = true;
  let source: TenantCurrencyContext["policy"]["source"] = "platform";

  if (tenant.type === TenantType.WHITE_LABEL) {
    const partnerSetting = await getPartnerCurrencySetting(tenant.id);
    const partnerAllowed = jsonCurrencyCodes(partnerSetting.allowedCurrencies);
    allowedCurrencies = partnerAllowed.length
      ? partnerAllowed
      : [partnerSetting.defaultCurrencyCode];
    defaultCurrencyCode = partnerSetting.defaultCurrencyCode;
    settlementCurrencyCode = partnerSetting.settlementCurrencyCode;
    passThroughCustomerCurrency = true;
    source = "partner";
  } else if (tenant.parentTenantId) {
    const partnerSetting = await prisma.partnerCurrencySetting.findUnique({
      where: { partnerTenantId: tenant.parentTenantId },
    });
    if (partnerSetting) {
      const partnerAllowed = jsonCurrencyCodes(partnerSetting.allowedCurrencies);
      allowedCurrencies = partnerAllowed.length
        ? partnerAllowed
        : [partnerSetting.defaultCurrencyCode];
      defaultCurrencyCode = partnerSetting.defaultCurrencyCode;
      settlementCurrencyCode = partnerSetting.settlementCurrencyCode;
      passThroughCustomerCurrency = partnerSetting.passThroughCustomerCurrency;
      source = "partner";
    }
  }

  const fallbackAllowed = resolveAllowedCurrencyCodes({
    allowedCurrencies,
    activeCurrencyCodes: activeCodes,
    defaultCurrencyCode,
  });
  const customerSetting =
    tenant.type === TenantType.WHITE_LABEL
      ? null
      : await getCustomerCurrencySetting(tenant.id);
  const currencyCode = resolveCurrencyPreference({
    requestedCurrencyCode: customerSetting?.currencyCode,
    defaultCurrencyCode,
    allowedCurrencies: fallbackAllowed,
  });
  const currency =
    activeCurrencies.find((row) => row.code === currencyCode) ??
    LAUNCH_CURRENCIES.find((row) => row.code === currencyCode);

  return {
    setting: {
      tenantId: tenant.id,
      currencyCode,
      locale:
        customerSetting?.locale && customerSetting.locale.trim()
          ? customerSetting.locale
          : defaultLocaleForCurrency(currencyCode),
      symbol: currency?.symbol ?? currencyCode,
      minorUnit: currency?.minorUnit ?? 2,
      showConvertedAmounts: customerSetting?.showConvertedAmounts ?? true,
      canUpdatePreference:
        tenant.type !== TenantType.WHITE_LABEL && passThroughCustomerCurrency,
    },
    policy: {
      source,
      defaultCurrencyCode,
      settlementCurrencyCode,
      allowedCurrencies: fallbackAllowed,
      passThroughCustomerCurrency,
    },
    currencies: currencyRowsForAllowedCodes(activeCurrencies, fallbackAllowed),
  };
}

export async function setTenantCurrencyPreference(input: {
  tenantId: string;
  currencyCode: string;
  locale?: string;
  showConvertedAmounts?: boolean;
  createdByUserId?: string;
}) {
  const context = await getTenantCurrencyContext(input.tenantId);
  if (!context.setting.canUpdatePreference) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "Currency preference is locked by the partner policy.",
    );
  }
  const currencyCode = normalizeCurrency(input.currencyCode);
  if (!context.policy.allowedCurrencies.includes(currencyCode)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Currency ${currencyCode} is not allowed for this tenant.`,
    );
  }
  return setCustomerCurrencySetting({
    tenantId: input.tenantId,
    currencyCode,
    locale: input.locale ?? defaultLocaleForCurrency(currencyCode),
    showConvertedAmounts: input.showConvertedAmounts,
    createdByUserId: input.createdByUserId,
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
