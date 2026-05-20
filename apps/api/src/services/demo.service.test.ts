import { beforeEach, describe, expect, it, vi } from "vitest";
import { TenantStatus, TenantType, UserRole } from "@nexaflow/shared";

// Backfill tests for Codex's Phase 4 demo service (no coverage at ship).
// We mock @nexaflow/db prisma + auth.service so the tests stay
// hermetic — these are unit tests on the business rules, not the DB.

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  tenantDelete: vi.fn(),
  demoTenantFindUnique: vi.fn(),
  demoTenantUpdate: vi.fn(),
  demoTenantFindMany: vi.fn(),
  demoTenantCount: vi.fn(),
  transaction: vi.fn(),
  hashPassword: vi.fn().mockResolvedValue("hashed_password"),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    tenant: {
      findUnique: mocks.tenantFindUnique,
      delete: mocks.tenantDelete,
    },
    demoTenant: {
      findUnique: mocks.demoTenantFindUnique,
      update: mocks.demoTenantUpdate,
      findMany: mocks.demoTenantFindMany,
      count: mocks.demoTenantCount,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("./auth.service", () => ({
  authService: { hashPassword: mocks.hashPassword },
}));

describe("demo.service", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => {
      if (typeof m === "function" && "mockReset" in m) {
        m.mockReset();
      }
    });
    mocks.hashPassword.mockResolvedValue("hashed_password");
  });

  // -- createDemoTenant ------------------------------------------------------

  it("createDemoTenant: 404s when the partner tenant is missing", async () => {
    mocks.tenantFindUnique.mockResolvedValue(null);
    const { createDemoTenant } = await import("./demo.service");
    await expect(
      createDemoTenant({ partnerTenantId: "missing" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: /Partner tenant not found/,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("createDemoTenant: 403s when partner is BUSINESS (only WHITE_LABEL/DIRECT allowed)", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      id: "biz_1",
      type: TenantType.BUSINESS,
      status: TenantStatus.ACTIVE,
    });
    const { createDemoTenant } = await import("./demo.service");
    await expect(
      createDemoTenant({ partnerTenantId: "biz_1" }),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: /Only WHITE_LABEL or DIRECT/,
    });
  });

  it("createDemoTenant: 403s when partner is SUSPENDED", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      id: "p_1",
      type: TenantType.WHITE_LABEL,
      status: TenantStatus.SUSPENDED,
    });
    const { createDemoTenant } = await import("./demo.service");
    await expect(
      createDemoTenant({ partnerTenantId: "p_1" }),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: /Partner tenant is not active/,
    });
  });

  it("createDemoTenant: happy path — calculates expiry from expiryDays, returns redacted credentials shape", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      id: "p_1",
      type: TenantType.WHITE_LABEL,
      status: TenantStatus.ACTIVE,
    });
    const beforeMs = Date.now();
    // Mock the transaction body — pass through and synthesize a result.
    // The seedDemoData helper called inside the tx references fields that
    // don't exist on the current schema (firstName/lastName/source/etc) —
    // see follow-up task #22. We mock those calls as resolved so the
    // outer createDemoTenant happy path is testable in isolation.
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const noop = vi.fn().mockResolvedValue({});
      const txMock = {
        tenant: {
          // Use a CUID-shaped id (no underscores) — the service slices
          // .slice(0,8) into the email local-part, which must match
          // [a-z0-9]+ to be a valid email user component.
          create: vi.fn().mockResolvedValue({ id: "clxyz1234abcdef" }),
        },
        demoTenant: {
          create: vi.fn().mockResolvedValue({ id: "dt_1" }),
        },
        user: { create: noop },
        contact: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
        whatsAppTemplate: { create: noop },
        campaign: { create: noop },
        lead: { create: noop, createMany: noop },
      };
      return fn(txMock);
    });

    const { createDemoTenant } = await import("./demo.service");
    const result = await createDemoTenant({
      partnerTenantId: "p_1",
      demoName: "ACME Demo",
      expiryDays: 30,
    });

    expect(result.tenantId).toBe("clxyz1234abcdef");
    // Credentials present + the password is the GENERATED plaintext (not the
    // hash) — that's the point: the caller needs it once to give to the
    // operator. Hash goes to the DB.
    expect(result.credentials.email).toMatch(/^demo-[a-z0-9]+@demo\.nexaflow\.local$/);
    expect(typeof result.credentials.password).toBe("string");
    expect(result.credentials.password.length).toBeGreaterThan(8);
    expect(result.renewalCount).toBe(0);

    // Expiry is roughly 30 days in the future.
    const days = (result.expiresAt.getTime() - beforeMs) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  // -- renewDemoTenant -------------------------------------------------------

  it("renewDemoTenant: 404s when the demo tenant doesn't exist", async () => {
    mocks.demoTenantFindUnique.mockResolvedValue(null);
    const { renewDemoTenant } = await import("./demo.service");
    await expect(renewDemoTenant("missing")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("renewDemoTenant: caps renewals at 2 (third attempt → 400)", async () => {
    mocks.demoTenantFindUnique.mockResolvedValue({
      id: "dt_1",
      renewalCount: 2,
    });
    const { renewDemoTenant } = await import("./demo.service");
    await expect(renewDemoTenant("dt_1")).rejects.toMatchObject({
      statusCode: 400,
      message: /maximum renewal count/,
    });
    expect(mocks.demoTenantUpdate).not.toHaveBeenCalled();
  });

  it("renewDemoTenant: extends expiry + increments count when below cap", async () => {
    mocks.demoTenantFindUnique.mockResolvedValue({
      id: "dt_1",
      renewalCount: 0,
    });
    const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    mocks.demoTenantUpdate.mockResolvedValue({
      expiresAt: newExpiry,
      renewalCount: 1,
    });
    const { renewDemoTenant } = await import("./demo.service");
    const result = await renewDemoTenant("dt_1", 30);
    expect(result.renewalCount).toBe(1);
    const updateCall = mocks.demoTenantUpdate.mock.calls[0][0];
    expect(updateCall.data.renewalCount).toEqual({ increment: 1 });
    expect(updateCall.data.lastRenewedAt).toBeInstanceOf(Date);
  });

  // -- deleteDemoTenant ------------------------------------------------------

  it("deleteDemoTenant: 404s when missing; cascade-deletes via parent tenant when found", async () => {
    mocks.demoTenantFindUnique.mockResolvedValueOnce(null);
    const { deleteDemoTenant } = await import("./demo.service");
    await expect(deleteDemoTenant("missing")).rejects.toMatchObject({
      statusCode: 404,
    });

    mocks.demoTenantFindUnique.mockResolvedValueOnce({
      id: "dt_1",
      tenantId: "demo_t_1",
    });
    mocks.tenantDelete.mockResolvedValue({});
    await deleteDemoTenant("dt_1");
    expect(mocks.tenantDelete).toHaveBeenCalledWith({
      where: { id: "demo_t_1" },
    });
  });

  // -- listPartnerDemos ------------------------------------------------------

  it("listPartnerDemos: scopes every query by createdByPartnerId", async () => {
    mocks.demoTenantFindMany.mockResolvedValue([]);
    mocks.demoTenantCount.mockResolvedValue(0);
    const { listPartnerDemos } = await import("./demo.service");
    await listPartnerDemos("p_1", 2, 10);
    expect(mocks.demoTenantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdByPartnerId: "p_1" },
        skip: 10,
        take: 10,
      }),
    );
    expect(mocks.demoTenantCount).toHaveBeenCalledWith({
      where: { createdByPartnerId: "p_1" },
    });
  });

  // -- cleanupExpiredDemos ---------------------------------------------------

  it("cleanupExpiredDemos: deletes only rows with expiresAt <= now and counts successes", async () => {
    mocks.demoTenantFindMany.mockResolvedValue([
      { tenantId: "t_1" },
      { tenantId: "t_2" },
      { tenantId: "t_3" },
    ]);
    mocks.tenantDelete
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("foreign key violation"))
      .mockResolvedValueOnce({});

    const { cleanupExpiredDemos } = await import("./demo.service");
    const result = await cleanupExpiredDemos();
    expect(result.deleted).toBe(2); // 1 failure swallowed + counted
    const findArg = mocks.demoTenantFindMany.mock.calls[0][0];
    expect(findArg.where.expiresAt.lte).toBeInstanceOf(Date);
  });
});
