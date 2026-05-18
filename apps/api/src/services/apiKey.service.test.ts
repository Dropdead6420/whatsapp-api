import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiKeyFindMany: vi.fn(),
  apiKeyFindUnique: vi.fn(),
  apiKeyFindFirst: vi.fn(),
  apiKeyCreate: vi.fn(),
  apiKeyUpdate: vi.fn(),
  apiKeyDelete: vi.fn(),
  apiRequestLogCreate: vi.fn(),
  apiRequestLogFindMany: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    apiKey: {
      findMany: mocks.apiKeyFindMany,
      findUnique: mocks.apiKeyFindUnique,
      findFirst: mocks.apiKeyFindFirst,
      create: mocks.apiKeyCreate,
      update: mocks.apiKeyUpdate,
      delete: mocks.apiKeyDelete,
    },
    apiRequestLog: {
      create: mocks.apiRequestLogCreate,
      findMany: mocks.apiRequestLogFindMany,
    },
  },
}));

const now = new Date("2026-05-18T10:00:00.000Z");

function dbKey(overrides: Record<string, unknown> = {}) {
  return {
    id: "key_1",
    tenantId: "tenant_1",
    userId: "user_1",
    keyHash: "never-return-this",
    name: "Production API",
    lastUsedAt: null,
    rateLimit: 1000,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    user: {
      id: "user_1",
      name: "Sidharth",
      email: "sid@example.com",
    },
    ...overrides,
  };
}

describe("apiKey.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates prefixed keys and hashes them with sha256", async () => {
    const { generateApiKeySecret, hashApiKey } = await import(
      "./apiKey.service"
    );
    const secret = generateApiKeySecret();

    expect(secret).toMatch(/^nxf_live_[A-Za-z0-9_-]+$/);
    expect(hashApiKey(secret)).toHaveLength(64);
    expect(hashApiKey(secret)).not.toBe(secret);
  });

  it("lists tenant-scoped keys without exposing key hashes", async () => {
    mocks.apiKeyFindMany.mockResolvedValue([dbKey()]);

    const { listApiKeys } = await import("./apiKey.service");
    const result = await listApiKeys("tenant_1");

    expect(mocks.apiKeyFindMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant_1" },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });
    expect(result[0]).toEqual(
      expect.not.objectContaining({ keyHash: expect.any(String) }),
    );
  });

  it("creates a key with a stored hash and returns the secret once", async () => {
    mocks.apiKeyCreate.mockResolvedValue(dbKey());

    const { createApiKey } = await import("./apiKey.service");
    const result = await createApiKey({
      tenantId: "tenant_1",
      userId: "user_1",
      name: "Production API",
      rateLimit: 2500,
    });

    expect(result.secret).toMatch(/^nxf_live_/);
    expect(result.apiKey).toEqual(
      expect.not.objectContaining({ keyHash: expect.any(String) }),
    );
    expect(mocks.apiKeyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant_1",
        userId: "user_1",
        name: "Production API",
        rateLimit: 2500,
        keyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  });

  it("revokes only keys belonging to the tenant", async () => {
    mocks.apiKeyFindFirst.mockResolvedValue(dbKey());
    mocks.apiKeyDelete.mockResolvedValue(dbKey());

    const { revokeApiKey } = await import("./apiKey.service");
    const revoked = await revokeApiKey({ tenantId: "tenant_1", id: "key_1" });

    expect(mocks.apiKeyFindFirst).toHaveBeenCalledWith({
      where: { id: "key_1", tenantId: "tenant_1" },
    });
    expect(mocks.apiKeyDelete).toHaveBeenCalledWith({
      where: { id: "key_1" },
    });
    expect(revoked.id).toBe("key_1");
  });

  it("authenticates a valid API key and updates last-used asynchronously", async () => {
    const secret = "nxf_live_testsecret";
    mocks.apiKeyFindUnique.mockResolvedValue({
      id: "key_1",
      tenantId: "tenant_1",
      name: "Production API",
      rateLimit: 1000,
      expiresAt: null,
      tenant: { status: "ACTIVE" },
    });
    mocks.apiKeyUpdate.mockResolvedValue(dbKey());

    const { authenticateApiKey, hashApiKey } = await import("./apiKey.service");
    const result = await authenticateApiKey(secret);

    expect(mocks.apiKeyFindUnique).toHaveBeenCalledWith({
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
    expect(result).toEqual({
      apiKeyId: "key_1",
      tenantId: "tenant_1",
      name: "Production API",
      rateLimit: 1000,
    });
    expect(mocks.apiKeyUpdate).toHaveBeenCalledWith({
      where: { id: "key_1" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it("rejects expired API keys", async () => {
    mocks.apiKeyFindUnique.mockResolvedValue({
      id: "key_1",
      tenantId: "tenant_1",
      name: "Expired API",
      rateLimit: 1000,
      expiresAt: new Date("2000-01-01T00:00:00.000Z"),
      tenant: { status: "ACTIVE" },
    });

    const { authenticateApiKey } = await import("./apiKey.service");

    await expect(authenticateApiKey("nxf_live_expired")).rejects.toThrow(
      "API key has expired.",
    );
  });

  it("records and lists request logs without leaking keys", async () => {
    const log = {
      id: "log_1",
      tenantId: "tenant_1",
      apiKeyId: "key_1",
      method: "GET",
      path: "/api/public/v1/status",
      statusCode: 200,
      durationMs: 12,
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
      createdAt: now,
    };
    mocks.apiRequestLogCreate.mockResolvedValue(log);
    mocks.apiKeyFindFirst.mockResolvedValue({ id: "key_1" });
    mocks.apiRequestLogFindMany.mockResolvedValue([log]);

    const { recordApiRequestLog, listApiRequestLogs } = await import(
      "./apiKey.service"
    );

    await recordApiRequestLog(log);
    const logs = await listApiRequestLogs({
      tenantId: "tenant_1",
      apiKeyId: "key_1",
    });

    expect(mocks.apiRequestLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant_1",
        apiKeyId: "key_1",
        method: "GET",
        statusCode: 200,
      }),
    });
    expect(mocks.apiRequestLogFindMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant_1", apiKeyId: "key_1" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    expect(logs).toEqual([log]);
  });
});
