import crypto from "node:crypto";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

const API_KEY_PREFIX = "nxf_live_";

export interface ApiKeySafe {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  lastUsedAt: Date | null;
  rateLimit: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface ApiKeyAuthContext {
  apiKeyId: string;
  tenantId: string;
  name: string;
  rateLimit: number;
}

export interface ApiRequestLogSafe {
  id: string;
  tenantId: string;
  apiKeyId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export function generateApiKeySecret(): string {
  return `${API_KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function looksLikeApiKey(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(API_KEY_PREFIX));
}

function sanitizeRateLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 1000;
  return Math.max(60, Math.min(10_000, Math.floor(value)));
}

function toSafeApiKey(apiKey: {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  lastUsedAt: Date | null;
  rateLimit: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  user?: { id: string; name: string; email: string } | null;
}): ApiKeySafe {
  return {
    id: apiKey.id,
    tenantId: apiKey.tenantId,
    userId: apiKey.userId,
    name: apiKey.name,
    lastUsedAt: apiKey.lastUsedAt,
    rateLimit: apiKey.rateLimit,
    createdAt: apiKey.createdAt,
    updatedAt: apiKey.updatedAt,
    expiresAt: apiKey.expiresAt,
    user: apiKey.user ?? undefined,
  };
}

export async function listApiKeys(tenantId: string): Promise<ApiKeySafe[]> {
  const keys = await prisma.apiKey.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  });
  return keys.map(toSafeApiKey);
}

export async function createApiKey(input: {
  tenantId: string;
  userId: string;
  name: string;
  rateLimit?: number;
  expiresAt?: Date | null;
}): Promise<{ apiKey: ApiKeySafe; secret: string }> {
  const secret = generateApiKeySecret();
  const created = await prisma.apiKey.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      keyHash: hashApiKey(secret),
      name: input.name,
      rateLimit: sanitizeRateLimit(input.rateLimit),
      expiresAt: input.expiresAt ?? null,
    },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  });
  return { apiKey: toSafeApiKey(created), secret };
}

export async function updateApiKey(input: {
  tenantId: string;
  id: string;
  name?: string;
  rateLimit?: number;
  expiresAt?: Date | null;
}): Promise<ApiKeySafe> {
  const existing = await prisma.apiKey.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "API key not found.");
  }

  const updated = await prisma.apiKey.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      rateLimit:
        input.rateLimit === undefined
          ? undefined
          : sanitizeRateLimit(input.rateLimit),
      expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt,
    },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  });
  return toSafeApiKey(updated);
}

export async function revokeApiKey(input: {
  tenantId: string;
  id: string;
}): Promise<ApiKeySafe> {
  const existing = await prisma.apiKey.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!existing) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "API key not found.");
  }

  await prisma.apiKey.delete({ where: { id: existing.id } });
  return toSafeApiKey(existing);
}

export async function authenticateApiKey(
  secret: string,
): Promise<ApiKeyAuthContext> {
  if (!looksLikeApiKey(secret)) {
    throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Invalid API key.");
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(secret) },
    select: {
      id: true,
      tenantId: true,
      name: true,
      rateLimit: true,
      expiresAt: true,
      tenant: {
        select: { status: true },
      },
    },
  });
  if (!apiKey) {
    throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Invalid API key.");
  }
  if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, "API key has expired.");
  }
  if (apiKey.tenant.status !== "ACTIVE") {
    throw new ApiError(ErrorCodes.FORBIDDEN, 403, "Tenant is not active.");
  }

  void prisma.apiKey
    .update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    })
    .catch((err) => console.error("[api-key] failed to update lastUsedAt", err));

  return {
    apiKeyId: apiKey.id,
    tenantId: apiKey.tenantId,
    name: apiKey.name,
    rateLimit: apiKey.rateLimit,
  };
}

export async function recordApiRequestLog(input: {
  tenantId: string;
  apiKeyId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await prisma.apiRequestLog.create({
      data: {
        tenantId: input.tenantId,
        apiKeyId: input.apiKeyId,
        method: input.method,
        path: input.path,
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    console.error("[api-key] failed to write request log", err);
  }
}

export async function listApiRequestLogs(input: {
  tenantId: string;
  apiKeyId: string;
  limit?: number;
}): Promise<ApiRequestLogSafe[]> {
  const existing = await prisma.apiKey.findFirst({
    where: { id: input.apiKeyId, tenantId: input.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "API key not found.");
  }

  return prisma.apiRequestLog.findMany({
    where: { tenantId: input.tenantId, apiKeyId: input.apiKeyId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(input.limit ?? 50, 1), 100),
  });
}
