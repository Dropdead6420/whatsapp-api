import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  routeFindMany: vi.fn(),
  routeFindFirst: vi.fn(),
  routeCreate: vi.fn(),
  routeUpdate: vi.fn(),
  routeDelete: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique },
    providerRoute: {
      findMany: mocks.routeFindMany,
      findFirst: mocks.routeFindFirst,
      create: mocks.routeCreate,
      update: mocks.routeUpdate,
      delete: mocks.routeDelete,
    },
  },
  WhatsAppProviderKey: {
    META: "META",
    GUPSHUP: "GUPSHUP",
    DIALOG_360: "DIALOG_360",
    TWILIO: "TWILIO",
    HAPTIK: "HAPTIK",
  },
}));

// Use the real tokenCrypto module — that's the encryption we want to
// exercise. The TENANT_TOKEN_ENCRYPTION_KEY env var has a dev fallback so
// encrypt/decrypt round-trips work without setup.

const NOW = new Date("2026-05-19T00:00:00Z");

function fakeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "rt_1",
    tenantId: "t_1",
    providerKey: "GUPSHUP",
    phoneNumberId: null,
    isActive: true,
    config: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("providerRoute.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("create encrypts the config blob and returns a redacted preview", async () => {
    mocks.tenantFindUnique.mockResolvedValue({ id: "t_1" });
    mocks.routeFindFirst.mockResolvedValue(null); // no duplicate
    mocks.routeCreate.mockImplementation(async ({ data }) =>
      fakeRow({ ...data, id: "rt_new" }),
    );

    const { createProviderRoute } = await import("./providerRoute.service");
    const created = await createProviderRoute({
      tenantId: "t_1",
      providerKey: "GUPSHUP" as never,
      config: {
        apiKey: "sk_super_secret_gupshup",
        appName: "TestApp",
        source: "919999999999",
      },
    });

    expect(created.id).toBe("rt_new");
    // The mock captured whatever the service passed to prisma.create.
    const callArgs = mocks.routeCreate.mock.calls[0][0];
    const writtenConfig = callArgs.data.config as string;
    expect(writtenConfig).not.toContain("sk_super_secret_gupshup"); // encrypted
    expect(writtenConfig.startsWith("v1:")).toBe(true);

    // Returned preview shows the SHAPE of the secret but not the value.
    // Mask format: >8 chars → `${first3}•••${last4}`; 5–8 → `•••${last2}`.
    expect(created.configPreview).toEqual({
      apiKey: "sk_•••shup", // 23 chars
      appName: "•••pp",     // 7 chars  → short-form
      source: "919•••9999", // 12 chars
    });
  });

  it("create surfaces the unique-constraint conflict as 409", async () => {
    mocks.tenantFindUnique.mockResolvedValue({ id: "t_1" });
    mocks.routeFindFirst.mockResolvedValue(fakeRow()); // a row already exists

    const { createProviderRoute } = await import("./providerRoute.service");
    await expect(
      createProviderRoute({
        tenantId: "t_1",
        providerKey: "GUPSHUP" as never,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("create rejects an unknown tenant with 404", async () => {
    mocks.tenantFindUnique.mockResolvedValue(null);

    const { createProviderRoute } = await import("./providerRoute.service");
    await expect(
      createProviderRoute({
        tenantId: "t_missing",
        providerKey: "GUPSHUP" as never,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.routeCreate).not.toHaveBeenCalled();
  });

  it("update re-encrypts when given a fresh config; clears on null", async () => {
    mocks.routeUpdate.mockImplementation(async ({ data }) =>
      fakeRow({ ...data, id: "rt_1" }),
    );

    const { updateProviderRoute } = await import("./providerRoute.service");

    // Replace config
    await updateProviderRoute({
      id: "rt_1",
      config: { apiKey: "rotated_key_1234" },
    });
    const writtenConfig = mocks.routeUpdate.mock.calls[0][0].data.config as string;
    expect(writtenConfig).not.toContain("rotated_key_1234");
    expect(writtenConfig.startsWith("v1:")).toBe(true);

    // Clear config (null)
    await updateProviderRoute({ id: "rt_1", config: null });
    expect(mocks.routeUpdate.mock.calls[1][0].data.config).toBeNull();

    // Untouched config (undefined) — the data object should not even
    // include a `config` key.
    await updateProviderRoute({ id: "rt_1", isActive: false });
    expect("config" in mocks.routeUpdate.mock.calls[2][0].data).toBe(false);
  });

  it("update maps Prisma's P2025 to 404", async () => {
    mocks.routeUpdate.mockRejectedValue({ code: "P2025" });
    const { updateProviderRoute } = await import("./providerRoute.service");
    await expect(
      updateProviderRoute({ id: "rt_missing", isActive: false }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("delete maps Prisma's P2025 to 404", async () => {
    mocks.routeDelete.mockRejectedValue({ code: "P2025" });
    const { deleteProviderRoute } = await import("./providerRoute.service");
    await expect(deleteProviderRoute("rt_missing")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("list passes through the redaction so secrets never leave the service", async () => {
    // Hand-craft an encrypted blob the way the service would write it.
    const { encryptToken } = await import("../lib/tokenCrypto");
    const stored = encryptToken(
      JSON.stringify({
        apiKey: "sk_live_X3M_secret_value_to_redact",
        appName: "ProdApp",
      }),
    );

    mocks.routeFindMany.mockResolvedValue([fakeRow({ config: stored })]);
    const { listProviderRoutes } = await import("./providerRoute.service");
    const [row] = await listProviderRoutes({ tenantId: "t_1" });
    expect(row.configPreview).toEqual({
      apiKey: "sk_•••dact", // 34 chars
      appName: "•••pp",     // 7 chars → short-form
    });
  });
});
