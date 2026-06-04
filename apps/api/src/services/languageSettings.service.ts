import {
  prisma,
  TenantType,
  TextDirection,
  type Prisma,
  type TranslationSourceType,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

export const LAUNCH_LANGUAGES = [
  { code: "en", name: "English", nativeName: "English", direction: TextDirection.LTR, displayOrder: 10 },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", direction: TextDirection.LTR, displayOrder: 20 },
  { code: "ur", name: "Urdu", nativeName: "اردو", direction: TextDirection.RTL, displayOrder: 30 },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", direction: TextDirection.LTR, displayOrder: 40 },
  { code: "ar", name: "Arabic", nativeName: "العربية", direction: TextDirection.RTL, displayOrder: 50 },
  { code: "fr", name: "French", nativeName: "Français", direction: TextDirection.LTR, displayOrder: 60 },
  { code: "es", name: "Spanish", nativeName: "Español", direction: TextDirection.LTR, displayOrder: 70 },
  { code: "de", name: "German", nativeName: "Deutsch", direction: TextDirection.LTR, displayOrder: 80 },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", direction: TextDirection.LTR, displayOrder: 90 },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", direction: TextDirection.LTR, displayOrder: 100 },
  { code: "te", name: "Telugu", nativeName: "తెలుగు", direction: TextDirection.LTR, displayOrder: 110 },
  { code: "mr", name: "Marathi", nativeName: "मराठी", direction: TextDirection.LTR, displayOrder: 120 },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી", direction: TextDirection.LTR, displayOrder: 130 },
] as const;

export interface LanguageUpsertInput {
  code: string;
  name: string;
  nativeName: string;
  direction?: TextDirection | "LTR" | "RTL";
  isActive?: boolean;
  isLaunchLanguage?: boolean;
  displayOrder?: number;
}

export interface CustomerLanguageSettingInput {
  tenantId: string;
  languageCode: string;
  locale?: string;
  allowAutoTranslate?: boolean;
  requireApprovalForSensitive?: boolean;
  createdByUserId?: string;
}

export interface PartnerLanguageSettingInput {
  partnerTenantId: string;
  defaultLanguageCode: string;
  allowedLanguages?: string[];
  allowCustomerOverride?: boolean;
  createdByUserId?: string;
}

export interface TranslationKeyInput {
  namespace?: string;
  key: string;
  defaultText: string;
  description?: string;
}

export interface PortalTranslationInput {
  translationKeyId: string;
  languageCode: string;
  text: string;
  status?: string;
  reviewedByUserId?: string;
}

export interface TranslationJobInput {
  tenantId: string;
  sourceType: TranslationSourceType;
  sourceId: string;
  sourceLanguageCode?: string;
  targetLanguageCode: string;
  requestedByUserId?: string;
}

export interface TenantLanguageContext {
  setting: {
    tenantId: string;
    languageCode: string;
    locale: string;
    direction: TextDirection;
    allowAutoTranslate: boolean;
    requireApprovalForSensitive: boolean;
    canUpdatePreference: boolean;
  };
  policy: {
    source: "customer" | "partner" | "platform";
    defaultLanguageCode: string;
    allowedLanguages: string[];
    allowCustomerOverride: boolean;
  };
  languages: Array<{
    code: string;
    name: string;
    nativeName: string;
    direction: TextDirection;
    isLaunchLanguage: boolean;
  }>;
}

const LANGUAGE_CODE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/;
const LOCALE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i;
const KEY_RE = /^[a-z][a-z0-9_.:-]{1,160}$/i;

const LAUNCH_BY_CODE: ReadonlyMap<string, (typeof LAUNCH_LANGUAGES)[number]> = new Map(
  LAUNCH_LANGUAGES.map((l) => [l.code, l]),
);

export function normalizeLanguageCode(input: string): string {
  const code = input.trim().toLowerCase();
  if (!LANGUAGE_CODE_RE.test(code)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Language code must be a valid short ISO/BCP-47 code.",
    );
  }
  return code;
}

export function normalizeLanguageCodes(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const code of codes) {
    seen.add(normalizeLanguageCode(code));
  }
  return [...seen].sort();
}

export function isRtlLanguageCode(input: string | null | undefined): boolean {
  if (!input) return false;
  const code = input.trim().toLowerCase().split("-")[0];
  return LAUNCH_BY_CODE.get(code)?.direction === TextDirection.RTL || code === "ar" || code === "ur";
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

function normalizeLocale(input: string | undefined, fallbackCode: string): string {
  const locale = (input?.trim() || (fallbackCode === "en" ? "en-IN" : fallbackCode)).toLowerCase();
  if (!LOCALE_RE.test(locale)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Locale is invalid.");
  }
  return locale;
}

export function normalizeLanguageUpsertInput(input: LanguageUpsertInput) {
  const code = normalizeLanguageCode(input.code);
  const name = input.name.trim();
  const nativeName = input.nativeName.trim();
  if (!name) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Language name is required.");
  }
  if (!nativeName) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Native language name is required.");
  }

  return {
    code,
    name,
    nativeName,
    direction: input.direction ?? (isRtlLanguageCode(code) ? TextDirection.RTL : TextDirection.LTR),
    isActive: input.isActive ?? true,
    isLaunchLanguage: input.isLaunchLanguage ?? false,
    displayOrder: assertDisplayOrder(input.displayOrder ?? 100),
  };
}

async function assertLanguageActive(code: string) {
  const normalized = normalizeLanguageCode(code);
  const language = await prisma.language.findUnique({ where: { code: normalized } });
  if (!language || !language.isActive) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Language ${normalized} is not active.`,
    );
  }
  return language;
}

async function assertTenant(id: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: { id: true, type: true, parentTenantId: true },
  });
  if (!tenant) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
  }
  return tenant;
}

function jsonLanguageCodes(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((code): code is string => typeof code === "string");
}

function directionForLanguageCode(
  code: string,
  languages: Array<{ code: string; direction: TextDirection }>,
): TextDirection {
  return (
    languages.find((language) => language.code === code)?.direction ??
    (isRtlLanguageCode(code) ? TextDirection.RTL : TextDirection.LTR)
  );
}

function languageRowsForAllowedCodes(
  languages: Awaited<ReturnType<typeof listLanguages>>,
  allowedCodes: string[],
) {
  const allowed = new Set(allowedCodes);
  return languages
    .filter((language) => allowed.has(language.code))
    .map((language) => ({
      code: language.code,
      name: language.name,
      nativeName: language.nativeName,
      direction: language.direction,
      isLaunchLanguage: language.isLaunchLanguage,
    }));
}

export async function listLanguages(args: { activeOnly?: boolean } = {}) {
  return prisma.language.findMany({
    where: args.activeOnly ? { isActive: true } : {},
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  });
}

export async function getTenantLanguageContext(
  tenantId: string,
): Promise<TenantLanguageContext> {
  const tenant = await assertTenant(tenantId);
  const activeLanguages = await listLanguages({ activeOnly: true });
  const activeCodes = activeLanguages.map((language) => language.code);
  let allowedLanguages = activeCodes;
  let defaultLanguageCode = "en";
  let allowCustomerOverride = true;
  let source: TenantLanguageContext["policy"]["source"] = "platform";

  if (tenant.type === TenantType.WHITE_LABEL) {
    const partnerSetting = await getPartnerLanguageSetting(tenant.id);
    const partnerAllowed = jsonLanguageCodes(partnerSetting.allowedLanguages);
    allowedLanguages = partnerAllowed.length ? partnerAllowed : [partnerSetting.defaultLanguageCode];
    defaultLanguageCode = partnerSetting.defaultLanguageCode;
    allowCustomerOverride = true;
    source = "partner";
  } else if (tenant.parentTenantId) {
    const partnerSetting = await prisma.partnerLanguageSetting.findUnique({
      where: { partnerTenantId: tenant.parentTenantId },
    });
    if (partnerSetting) {
      const partnerAllowed = jsonLanguageCodes(partnerSetting.allowedLanguages);
      allowedLanguages = partnerAllowed.length ? partnerAllowed : [partnerSetting.defaultLanguageCode];
      defaultLanguageCode = partnerSetting.defaultLanguageCode;
      allowCustomerOverride = partnerSetting.allowCustomerOverride;
      source = "partner";
    }
  }

  const activeAllowed = normalizeLanguageCodes(
    allowedLanguages.filter((code) => activeCodes.includes(normalizeLanguageCode(code))),
  );
  const fallbackAllowed = activeAllowed.length ? activeAllowed : ["en"];
  const customerSetting =
    tenant.type === TenantType.WHITE_LABEL
      ? null
      : await getCustomerLanguageSetting(tenant.id);
  const rawLanguageCode = customerSetting?.languageCode ?? defaultLanguageCode;
  const languageCode = fallbackAllowed.includes(rawLanguageCode)
    ? rawLanguageCode
    : fallbackAllowed.includes(defaultLanguageCode)
      ? defaultLanguageCode
      : fallbackAllowed[0]!;
  const locale = customerSetting?.locale ?? (languageCode === "en" ? "en-IN" : languageCode);
  const direction = directionForLanguageCode(languageCode, activeLanguages);

  return {
    setting: {
      tenantId: tenant.id,
      languageCode,
      locale,
      direction,
      allowAutoTranslate: customerSetting?.allowAutoTranslate ?? true,
      requireApprovalForSensitive: customerSetting?.requireApprovalForSensitive ?? true,
      canUpdatePreference: tenant.type !== TenantType.WHITE_LABEL && allowCustomerOverride,
    },
    policy: {
      source,
      defaultLanguageCode,
      allowedLanguages: fallbackAllowed,
      allowCustomerOverride,
    },
    languages: languageRowsForAllowedCodes(activeLanguages, fallbackAllowed),
  };
}

export async function setTenantLanguagePreference(input: {
  tenantId: string;
  languageCode: string;
  locale?: string;
  createdByUserId?: string;
}) {
  const context = await getTenantLanguageContext(input.tenantId);
  if (!context.setting.canUpdatePreference) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "Language preference is locked by the partner policy.",
    );
  }
  const languageCode = normalizeLanguageCode(input.languageCode);
  if (!context.policy.allowedLanguages.includes(languageCode)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Language ${languageCode} is not allowed for this tenant.`,
    );
  }
  return setCustomerLanguageSetting({
    tenantId: input.tenantId,
    languageCode,
    locale: input.locale,
    createdByUserId: input.createdByUserId,
  });
}

export async function upsertLanguage(input: LanguageUpsertInput) {
  const data = normalizeLanguageUpsertInput(input);
  return prisma.language.upsert({
    where: { code: data.code },
    update: data,
    create: data,
  });
}

export async function ensureLaunchLanguages() {
  for (const language of LAUNCH_LANGUAGES) {
    await upsertLanguage({
      ...language,
      isActive: true,
      isLaunchLanguage: true,
    });
  }
}

export async function getCustomerLanguageSetting(tenantId: string) {
  await assertTenant(tenantId);
  const existing = await prisma.customerLanguageSetting.findUnique({
    where: { tenantId },
  });
  if (existing) return existing;
  return prisma.customerLanguageSetting.create({
    data: { tenantId, languageCode: "en", locale: "en-IN" },
  });
}

export async function setCustomerLanguageSetting(
  input: CustomerLanguageSettingInput,
) {
  const tenant = await assertTenant(input.tenantId);
  if (tenant.type === TenantType.WHITE_LABEL) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Use partner language settings for white-label partners.",
    );
  }
  const language = await assertLanguageActive(input.languageCode);
  const locale = normalizeLocale(input.locale, language.code);

  return prisma.customerLanguageSetting.upsert({
    where: { tenantId: input.tenantId },
    update: {
      languageCode: language.code,
      locale,
      allowAutoTranslate: input.allowAutoTranslate,
      requireApprovalForSensitive: input.requireApprovalForSensitive,
      createdByUserId: input.createdByUserId,
    },
    create: {
      tenantId: input.tenantId,
      languageCode: language.code,
      locale,
      allowAutoTranslate: input.allowAutoTranslate ?? true,
      requireApprovalForSensitive: input.requireApprovalForSensitive ?? true,
      createdByUserId: input.createdByUserId,
    },
  });
}

export async function getPartnerLanguageSetting(partnerTenantId: string) {
  const tenant = await assertTenant(partnerTenantId);
  if (tenant.type !== TenantType.WHITE_LABEL) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Partner language settings require a white-label partner.",
    );
  }
  const existing = await prisma.partnerLanguageSetting.findUnique({
    where: { partnerTenantId },
  });
  if (existing) return existing;
  return prisma.partnerLanguageSetting.create({
    data: {
      partnerTenantId,
      defaultLanguageCode: "en",
      allowedLanguages: ["en"],
    },
  });
}

export async function setPartnerLanguageSetting(
  input: PartnerLanguageSettingInput,
) {
  const tenant = await assertTenant(input.partnerTenantId);
  if (tenant.type !== TenantType.WHITE_LABEL) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Partner language settings require a white-label partner.",
    );
  }

  const defaultLanguage = await assertLanguageActive(input.defaultLanguageCode);
  const allowed = normalizeLanguageCodes(
    input.allowedLanguages?.length ? input.allowedLanguages : [defaultLanguage.code],
  );
  for (const code of allowed) {
    await assertLanguageActive(code);
  }

  const allowedJson = allowed as unknown as Prisma.InputJsonValue;
  return prisma.partnerLanguageSetting.upsert({
    where: { partnerTenantId: input.partnerTenantId },
    update: {
      defaultLanguageCode: defaultLanguage.code,
      allowedLanguages: allowedJson,
      allowCustomerOverride: input.allowCustomerOverride,
      createdByUserId: input.createdByUserId,
    },
    create: {
      partnerTenantId: input.partnerTenantId,
      defaultLanguageCode: defaultLanguage.code,
      allowedLanguages: allowedJson,
      allowCustomerOverride: input.allowCustomerOverride ?? true,
      createdByUserId: input.createdByUserId,
    },
  });
}

export async function upsertTranslationKey(input: TranslationKeyInput) {
  const key = input.key.trim();
  const defaultText = input.defaultText.trim();
  const namespace = (input.namespace?.trim() || "common").toLowerCase();
  if (!KEY_RE.test(key)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Translation key is invalid.");
  }
  if (!defaultText) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Default text is required.");
  }
  return prisma.translationKey.upsert({
    where: { key },
    update: {
      namespace,
      defaultText,
      description: input.description?.trim() || null,
    },
    create: {
      namespace,
      key,
      defaultText,
      description: input.description?.trim() || null,
    },
  });
}

export async function upsertPortalTranslation(input: PortalTranslationInput) {
  const language = await assertLanguageActive(input.languageCode);
  const text = input.text.trim();
  if (!text) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Translation text is required.");
  }
  return prisma.portalTranslation.upsert({
    where: {
      translationKeyId_languageCode: {
        translationKeyId: input.translationKeyId,
        languageCode: language.code,
      },
    },
    update: {
      text,
      status: input.status ?? "published",
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: input.reviewedByUserId ? new Date() : undefined,
    },
    create: {
      translationKeyId: input.translationKeyId,
      languageCode: language.code,
      text,
      status: input.status ?? "published",
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: input.reviewedByUserId ? new Date() : undefined,
    },
  });
}

export async function createTranslationJob(input: TranslationJobInput) {
  await assertTenant(input.tenantId);
  await assertLanguageActive(input.sourceLanguageCode ?? "en");
  const targetLanguage = await assertLanguageActive(input.targetLanguageCode);
  const sourceId = input.sourceId.trim();
  if (!sourceId) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "sourceId is required.");
  }

  return prisma.translationJob.create({
    data: {
      tenantId: input.tenantId,
      sourceType: input.sourceType,
      sourceId,
      sourceLanguageCode: normalizeLanguageCode(input.sourceLanguageCode ?? "en"),
      targetLanguageCode: targetLanguage.code,
      requestedByUserId: input.requestedByUserId,
    },
  });
}

export async function listTranslationJobs(args: {
  tenantId?: string;
  status?: string;
  sourceType?: TranslationSourceType;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
  const offset = Math.max(args.offset ?? 0, 0);
  const where = {
    tenantId: args.tenantId,
    status: args.status as never,
    sourceType: args.sourceType,
  };
  const [items, total] = await prisma.$transaction([
    prisma.translationJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.translationJob.count({ where }),
  ]);
  return { items, total, limit, offset };
}
