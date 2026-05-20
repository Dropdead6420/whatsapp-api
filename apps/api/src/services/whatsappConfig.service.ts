import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { decryptTokenIfNeeded, encryptToken } from "../lib/tokenCrypto";

const META_GRAPH_BASE =
  process.env.META_GRAPH_BASE_URL ?? "https://graph.facebook.com/v20.0";

export interface WhatsAppConfigPublic {
  wabaId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  hasAccessToken: boolean;
  accessTokenPreview: string | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
  accountStatus: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  tokenExpiresAt: string | null;
  tokenExpiryWarning: "ok" | "warn" | "critical" | "expired" | null;
  businessName: string | null;
  businessVertical: string | null;
  businessAbout: string | null;
  businessProfileSyncedAt: string | null;
}

interface MetaPhoneNumberStatus {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
  name_status?: string;
  code_verification_status?: string;
  platform_type?: string;
  throughput?: { level?: string };
  error?: { message?: string; code?: number; type?: string };
}

function tokenPreview(token: string | null): string | null {
  if (!token) return null;
  if (token.length <= 12) return `${token.slice(0, 3)}...`;
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function tokenExpiryWarning(
  expiresAt: Date | null,
): "ok" | "warn" | "critical" | "expired" | null {
  if (!expiresAt) return null;
  const ms = expiresAt.getTime() - Date.now();
  const days = ms / (24 * 60 * 60 * 1000);
  if (ms <= 0) return "expired";
  if (days <= 3) return "critical";
  if (days <= 14) return "warn";
  return "ok";
}

function toPublicConfig(tenant: {
  wabaId: string | null;
  wabaPhoneNumber: string | null;
  wabaAccessToken: string | null;
  wabaTokenExpiresAt: Date | null;
  wabaDisplayPhoneNumber: string | null;
  wabaQualityRating: string | null;
  wabaMessagingLimitTier: string | null;
  wabaAccountStatus: string | null;
  wabaLastSyncedAt: Date | null;
  wabaLastSyncError: string | null;
  wabaBusinessName: string | null;
  wabaBusinessVertical: string | null;
  wabaBusinessAbout: string | null;
  wabaBusinessProfileSyncedAt: Date | null;
}): WhatsAppConfigPublic {
  return {
    wabaId: tenant.wabaId,
    phoneNumberId: tenant.wabaPhoneNumber,
    displayPhoneNumber: tenant.wabaDisplayPhoneNumber,
    hasAccessToken: Boolean(tenant.wabaAccessToken),
    accessTokenPreview: tokenPreview(tenant.wabaAccessToken),
    qualityRating: tenant.wabaQualityRating,
    messagingLimitTier: tenant.wabaMessagingLimitTier,
    accountStatus: tenant.wabaAccountStatus,
    lastSyncedAt: tenant.wabaLastSyncedAt?.toISOString() ?? null,
    lastSyncError: tenant.wabaLastSyncError,
    tokenExpiresAt: tenant.wabaTokenExpiresAt?.toISOString() ?? null,
    tokenExpiryWarning: tokenExpiryWarning(tenant.wabaTokenExpiresAt),
    businessName: tenant.wabaBusinessName,
    businessVertical: tenant.wabaBusinessVertical,
    businessAbout: tenant.wabaBusinessAbout,
    businessProfileSyncedAt:
      tenant.wabaBusinessProfileSyncedAt?.toISOString() ?? null,
  };
}

export async function getWhatsAppConfig(
  tenantId: string,
): Promise<WhatsAppConfigPublic> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      wabaId: true,
      wabaPhoneNumber: true,
      wabaAccessToken: true,
      wabaDisplayPhoneNumber: true,
      wabaQualityRating: true,
      wabaMessagingLimitTier: true,
      wabaAccountStatus: true,
      wabaLastSyncedAt: true,
      wabaTokenExpiresAt: true,
      wabaLastSyncError: true,
      wabaBusinessName: true,
      wabaBusinessVertical: true,
      wabaBusinessAbout: true,
      wabaBusinessProfileSyncedAt: true,
    },
  });
  if (!tenant) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
  }
  return toPublicConfig(tenant);
}

export async function updateWhatsAppConfig(
  tenantId: string,
  input: {
    wabaId?: string | null;
    phoneNumberId?: string | null;
    accessToken?: string | null;
    clearAccessToken?: boolean;
  },
): Promise<WhatsAppConfigPublic> {
  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      wabaId: input.wabaId === undefined ? undefined : input.wabaId || null,
      wabaPhoneNumber:
        input.phoneNumberId === undefined ? undefined : input.phoneNumberId || null,
      wabaAccessToken: input.clearAccessToken
        ? null
        : input.accessToken === undefined
          ? undefined
          : input.accessToken
            ? encryptToken(input.accessToken)
            : null,
      wabaLastSyncError: null,
    },
    select: {
      wabaId: true,
      wabaPhoneNumber: true,
      wabaAccessToken: true,
      wabaDisplayPhoneNumber: true,
      wabaQualityRating: true,
      wabaMessagingLimitTier: true,
      wabaAccountStatus: true,
      wabaLastSyncedAt: true,
      wabaTokenExpiresAt: true,
      wabaLastSyncError: true,
      wabaBusinessName: true,
      wabaBusinessVertical: true,
      wabaBusinessAbout: true,
      wabaBusinessProfileSyncedAt: true,
    },
  });
  return toPublicConfig(tenant);
}

export async function syncWhatsAppBusinessStatus(
  tenantId: string,
): Promise<WhatsAppConfigPublic> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      wabaPhoneNumber: true,
      wabaAccessToken: true,
    },
  });
  if (!tenant?.wabaPhoneNumber || !tenant?.wabaAccessToken) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "WhatsApp phone number ID and access token are required before syncing.",
    );
  }

  // Decrypt before bearing it as a Meta Graph token.
  const accessToken = decryptTokenIfNeeded(tenant.wabaAccessToken);
  if (!accessToken) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "WhatsApp access token failed to decrypt.",
    );
  }

  const fields = [
    "display_phone_number",
    "verified_name",
    "quality_rating",
    "messaging_limit_tier",
    "name_status",
    "code_verification_status",
    "platform_type",
    "throughput",
  ].join(",");
  const url = `${META_GRAPH_BASE}/${tenant.wabaPhoneNumber}?fields=${encodeURIComponent(fields)}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await response.json().catch(() => ({}))) as MetaPhoneNumberStatus;
  if (!response.ok) {
    const message =
      data.error?.message ?? `Meta Graph API returned HTTP ${response.status}.`;
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        wabaLastSyncedAt: new Date(),
        wabaLastSyncError: message,
      },
      select: {
        wabaId: true,
        wabaPhoneNumber: true,
        wabaAccessToken: true,
        wabaDisplayPhoneNumber: true,
        wabaQualityRating: true,
        wabaMessagingLimitTier: true,
        wabaAccountStatus: true,
        wabaLastSyncedAt: true,
        wabaTokenExpiresAt: true,
        wabaLastSyncError: true,
        wabaBusinessName: true,
        wabaBusinessVertical: true,
        wabaBusinessAbout: true,
        wabaBusinessProfileSyncedAt: true,
      },
    });
    return toPublicConfig(updated);
  }

  const accountStatus =
    data.name_status ??
    data.code_verification_status ??
    data.platform_type ??
    null;
  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      wabaDisplayPhoneNumber: data.display_phone_number ?? null,
      wabaQualityRating: data.quality_rating ?? null,
      wabaMessagingLimitTier:
        data.messaging_limit_tier ?? data.throughput?.level ?? null,
      wabaAccountStatus: accountStatus,
      wabaLastSyncedAt: new Date(),
      wabaLastSyncError: null,
    },
    select: {
      wabaId: true,
      wabaPhoneNumber: true,
      wabaAccessToken: true,
      wabaDisplayPhoneNumber: true,
      wabaQualityRating: true,
      wabaMessagingLimitTier: true,
      wabaAccountStatus: true,
      wabaLastSyncedAt: true,
      wabaTokenExpiresAt: true,
      wabaLastSyncError: true,
      wabaBusinessName: true,
      wabaBusinessVertical: true,
      wabaBusinessAbout: true,
      wabaBusinessProfileSyncedAt: true,
    },
  });

  return toPublicConfig(updated);
}
