import { prisma, WhatsAppProviderKey } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { decryptTokenIfNeeded, encryptToken } from "../lib/tokenCrypto";

// SuperAdmin CRUD for ProviderRoute (T-005e, ADR-020).
//
// Encryption: the JSON config blob is envelope-encrypted on write via the
// same `tokenCrypto` module that protects `Tenant.wabaAccessToken`.
// Reads decrypt and return a redacted preview so the SuperAdmin UI can
// confirm the shape of the stored secret without leaking it.

export interface ProviderRouteSafe {
  id: string;
  tenantId: string;
  providerKey: WhatsAppProviderKey;
  phoneNumberId: string | null;
  isActive: boolean;
  /** Redacted preview of the encrypted config — keys present, values
   *  masked except for the last few chars. Null when no config is set
   *  or decryption failed. */
  configPreview: Record<string, string> | null;
  createdAt: Date;
  updatedAt: Date;
}

function maskSecret(value: unknown): string {
  if (typeof value !== "string") return "•••";
  if (value.length <= 4) return "•••";
  if (value.length <= 8) return `•••${value.slice(-2)}`;
  return `${value.slice(0, 3)}•••${value.slice(-4)}`;
}

function redactConfig(decrypted: string | null): Record<string, string> | null {
  if (!decrypted) return null;
  try {
    const parsed = JSON.parse(decrypted) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = maskSecret(v);
    }
    return out;
  } catch {
    return null;
  }
}

function toSafe(row: {
  id: string;
  tenantId: string;
  providerKey: WhatsAppProviderKey;
  phoneNumberId: string | null;
  isActive: boolean;
  config: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ProviderRouteSafe {
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerKey: row.providerKey,
    phoneNumberId: row.phoneNumberId,
    isActive: row.isActive,
    configPreview: redactConfig(decryptTokenIfNeeded(row.config)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listProviderRoutes(filter: {
  tenantId?: string;
}): Promise<ProviderRouteSafe[]> {
  const rows = await prisma.providerRoute.findMany({
    where: filter.tenantId ? { tenantId: filter.tenantId } : undefined,
    orderBy: [{ tenantId: "asc" }, { phoneNumberId: "asc" }],
  });
  return rows.map(toSafe);
}

export async function createProviderRoute(input: {
  tenantId: string;
  providerKey: WhatsAppProviderKey;
  phoneNumberId?: string | null;
  isActive?: boolean;
  config?: Record<string, unknown> | null;
}): Promise<ProviderRouteSafe> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { id: true },
  });
  if (!tenant) {
    throw new ApiError(
      ErrorCodes.NOT_FOUND,
      404,
      "Tenant not found.",
    );
  }

  const phoneNumberId = input.phoneNumberId?.trim() || null;

  // Unique constraint is (tenantId, phoneNumberId). Surface a 409 instead
  // of letting Prisma's P2002 bubble.
  const existing = await prisma.providerRoute.findFirst({
    where: { tenantId: input.tenantId, phoneNumberId },
  });
  if (existing) {
    throw new ApiError(
      ErrorCodes.CONFLICT,
      409,
      phoneNumberId
        ? `A route already exists for tenant ${input.tenantId} and phone ${phoneNumberId}.`
        : `A default route already exists for tenant ${input.tenantId}.`,
    );
  }

  const config =
    input.config && typeof input.config === "object"
      ? encryptToken(JSON.stringify(input.config))
      : null;

  const created = await prisma.providerRoute.create({
    data: {
      tenantId: input.tenantId,
      providerKey: input.providerKey,
      phoneNumberId,
      isActive: input.isActive ?? true,
      config,
    },
  });
  return toSafe(created);
}

export async function updateProviderRoute(input: {
  id: string;
  providerKey?: WhatsAppProviderKey;
  isActive?: boolean;
  /** Pass `undefined` to leave config untouched, `null` to clear it,
   *  or an object to replace + re-encrypt. */
  config?: Record<string, unknown> | null | undefined;
}): Promise<ProviderRouteSafe> {
  const data: Record<string, unknown> = {};
  if (input.providerKey !== undefined) data.providerKey = input.providerKey;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.config === null) {
    data.config = null;
  } else if (input.config !== undefined) {
    data.config = encryptToken(JSON.stringify(input.config));
  }

  try {
    const updated = await prisma.providerRoute.update({
      where: { id: input.id },
      data,
    });
    return toSafe(updated);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code === "P2025"
    ) {
      throw new ApiError(
        ErrorCodes.NOT_FOUND,
        404,
        "Provider route not found.",
      );
    }
    throw err;
  }
}

export async function deleteProviderRoute(id: string): Promise<ProviderRouteSafe> {
  try {
    const row = await prisma.providerRoute.delete({ where: { id } });
    return toSafe(row);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code === "P2025"
    ) {
      throw new ApiError(
        ErrorCodes.NOT_FOUND,
        404,
        "Provider route not found.",
      );
    }
    throw err;
  }
}
