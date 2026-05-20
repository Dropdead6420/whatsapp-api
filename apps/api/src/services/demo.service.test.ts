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

  it("createDemoTenant: happy path — calculates expiry, redacted credentials, seeds with REAL schema fields (regression for task #22)", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      id: "p_1",
      type: TenantType.WHITE_LABEL,
      status: TenantStatus.ACTIVE,
    });
    const beforeMs = Date.now();

    // Capture every call to the tx.* methods so we can assert the
    // payloads match the actual Prisma schema. The previous version of
    // seedDemoData passed `firstName`/`source`/`headerFormat`/etc which
    // don't exist on the schema and would crash at runtime — typed `tx:
    // any` hid it from tsc, so we lock it here.
    const captured = {
      contactCreateMany: vi.fn().mockResolvedValue({ count: 5 }),
      templateCreate: vi.fn().mockResolvedValue({ id: "tpl_seed_1" }),
      campaignCreate: vi.fn().mockResolvedValue({}),
      leadCreate: vi.fn().mockResolvedValue({}),
    };
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const noop = vi.fn().mockResolvedValue({});
      const txMock = {
        tenant: { create: vi.fn().mockResolvedValue({ id: "clxyz1234abcdef" }) },
        demoTenant: { create: vi.fn().mockResolvedValue({ id: "dt_1" }) },
        user: { create: noop },
        contact: {
          createMany: captured.contactCreateMany,
          findUnique: vi.fn().mockResolvedValue({ id: "contact_seed_1" }),
        },
        whatsAppTemplate: { create: captured.templateCreate },
        campaign: { create: captured.campaignCreate },
        lead: { create: captured.leadCreate },
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
    expect(result.credentials.email).toMatch(/^demo-[a-z0-9]+@demo\.nexaflow\.local$/);
    expect(result.credentials.password.length).toBeGreaterThan(8);
    expect(result.renewalCount).toBe(0);

    const days = (result.expiresAt.getTime() - beforeMs) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    // --- task #22 regression guard ----------------------------------------
    // Contact payload uses the schema's actual fields (name, phoneNumber,
    // email, tags, lifecycleStage) — NOT firstName/lastName/source.
    const contactPayload = captured.contactCreateMany.mock.calls[0][0].data;
    expect(Array.isArray(contactPayload)).toBe(true);
    expect(contactPayload[0]).toMatchObject({
      tenantId: "clxyz1234abcdef",
      name: "Alice Johnson",
      phoneNumber: expect.stringMatching(/^\+/),
      tags: ["demo"],
      lifecycleStage: "LEAD",
    });
    expect(contactPayload[0]).not.toHaveProperty("firstName");
    expect(contactPayload[0]).not.toHaveProperty("source");

    // Template uses bodyText (not body) + no headerFormat / source.
    const templatePayload = captured.templateCreate.mock.calls[0][0].data;
    expect(templatePayload).toMatchObject({
      bodyText: expect.stringContaining("welcome"),
      category: "MARKETING",
      status: "APPROVED",
    });
    expect(templatePayload).not.toHaveProperty("body");
    expect(templatePayload).not.toHaveProperty("headerFormat");

    // Campaign needs templateId (FK) + targetContacts as JSON string,
    // not the broken `targetList` / `messageTemplate` / `createdBy`.
    const campaignPayload = captured.campaignCreate.mock.calls[0][0].data;
    expect(campaignPayload).toMatchObject({
      templateId: "tpl_seed_1",
      type: "BROADCAST",
      status: "DRAFT",
    });
    expect(typeof campaignPayload.targetContacts).toBe("string");
    expect(campaignPayload).not.toHaveProperty("targetList");
    expect(campaignPayload).not.toHaveProperty("messageTemplate");
    expect(campaignPayload).not.toHaveProperty("createdBy");

    // Lead uses contactId + title; not firstName/email/assignedTeamId.
    const leadPayload = captured.leadCreate.mock.calls[0][0].data;
    expect(leadPayload).toMatchObject({
      contactId: "contact_seed_1",
      title: expect.any(String),
      status: "NEW",
    });
    expect(leadPayload).not.toHaveProperty("firstName");
    expect(leadPayload).not.toHaveProperty("assignedTeamId");
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
