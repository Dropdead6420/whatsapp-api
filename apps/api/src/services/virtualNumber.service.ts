import { prisma, VirtualNumberStatus } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// Calling — virtual number registry service (Complete Planning PDF §2.21,
// Phase 11). The numbers a tenant uses for calling. Pure helpers (E.164
// normalisation, capability normalisation, safe view) are unit-tested;
// live provisioning via a telephony provider lands later.
// =====================================================================

export const NUMBER_CAPABILITIES = ["voice", "sms", "whatsapp"] as const;
export type NumberCapability = (typeof NUMBER_CAPABILITIES)[number];

// ---------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------

/** Validate + normalise a phone number to E.164 (e.g. +14155552671). */
export function normalizePhone(input: string): string {
  const cleaned = (input ?? "").replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Phone number must be E.164 format, e.g. +14155552671.",
    );
  }
  return cleaned;
}

/** Keep only known capabilities, lowercased + de-duplicated. */
export function normalizeCapabilities(input: unknown): NumberCapability[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<NumberCapability>();
  for (const raw of input) {
    const v = String(raw).trim().toLowerCase();
    if ((NUMBER_CAPABILITIES as readonly string[]).includes(v)) {
      out.add(v as NumberCapability);
    }
  }
  return [...out];
}

interface NumberRow {
  id: string;
  tenantId: string;
  phoneNumber: string;
  label: string | null;
  countryCode: string | null;
  provider: string | null;
  capabilities: string[];
  secretId: string | null;
  status: VirtualNumberStatus;
  createdAt: Date;
  updatedAt: Date;
}

export function toSafeNumber(row: NumberRow) {
  return {
    id: row.id,
    phoneNumber: row.phoneNumber,
    label: row.label,
    countryCode: row.countryCode,
    provider: row.provider,
    capabilities: row.capabilities,
    hasCredential: Boolean(row.secretId),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (tenant-scoped)
// ---------------------------------------------------------------------

export async function listNumbers(tenantId: string, status?: VirtualNumberStatus) {
  const rows = await prisma.virtualNumber.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toSafeNumber);
}

async function assertSecretOwned(tenantId: string, secretId?: string | null) {
  if (!secretId) return;
  const secret = await prisma.secretVaultEntry.findFirst({
    where: { id: secretId, tenantId },
    select: { id: true },
  });
  if (!secret) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Referenced secret was not found in your vault.");
  }
}

export interface AddNumberInput {
  phoneNumber: string;
  label?: string;
  countryCode?: string;
  provider?: string;
  capabilities?: unknown;
  secretId?: string | null;
  createdByUserId?: string;
}

export async function addNumber(tenantId: string, input: AddNumberInput) {
  const phoneNumber = normalizePhone(input.phoneNumber);
  await assertSecretOwned(tenantId, input.secretId);

  const clash = await prisma.virtualNumber.findFirst({
    where: { tenantId, phoneNumber },
    select: { id: true },
  });
  if (clash) {
    throw new ApiError(ErrorCodes.CONFLICT, 409, `${phoneNumber} is already registered.`);
  }

  const row = await prisma.virtualNumber.create({
    data: {
      tenantId,
      phoneNumber,
      label: input.label?.trim() || null,
      countryCode: input.countryCode?.trim() || null,
      provider: input.provider?.trim() || null,
      capabilities: normalizeCapabilities(input.capabilities),
      secretId: input.secretId ?? null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return toSafeNumber(row);
}

async function findOwnedOrThrow(tenantId: string, id: string) {
  const row = await prisma.virtualNumber.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Virtual number not found.");
  return row;
}

export async function getNumber(tenantId: string, id: string) {
  return toSafeNumber(await findOwnedOrThrow(tenantId, id));
}

export interface UpdateNumberInput {
  label?: string | null;
  countryCode?: string | null;
  provider?: string | null;
  capabilities?: unknown;
  secretId?: string | null;
  status?: VirtualNumberStatus;
}

export async function updateNumber(tenantId: string, id: string, input: UpdateNumberInput) {
  await findOwnedOrThrow(tenantId, id);
  if (input.secretId !== undefined) await assertSecretOwned(tenantId, input.secretId);
  const row = await prisma.virtualNumber.update({
    where: { id },
    data: {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      ...(input.capabilities !== undefined
        ? { capabilities: normalizeCapabilities(input.capabilities) }
        : {}),
      ...(input.secretId !== undefined ? { secretId: input.secretId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
  return toSafeNumber(row);
}

/** Release a number (soft) — keeps the record for history. */
export async function releaseNumber(tenantId: string, id: string) {
  await findOwnedOrThrow(tenantId, id);
  const row = await prisma.virtualNumber.update({
    where: { id },
    data: { status: VirtualNumberStatus.RELEASED },
  });
  return toSafeNumber(row);
}
