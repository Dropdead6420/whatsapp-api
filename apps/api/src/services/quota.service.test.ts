import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  contactCount: vi.fn(),
  campaignCount: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique },
    contact: { count: mocks.contactCount },
    campaign: { count: mocks.campaignCount },
  },
}));

import { assertContactQuota, assertCampaignQuota } from "./quota.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertContactQuota", () => {
  it("no-ops when the tenant row is missing", async () => {
    mocks.tenantFindUnique.mockResolvedValue(null);
    await expect(assertContactQuota("t1", 1)).resolves.toBeUndefined();
    expect(mocks.contactCount).not.toHaveBeenCalled();
  });

  it("no-ops when contactLimit is 0 (treated as unlimited)", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      contactLimit: 0,
      campaignLimit: 10,
    });
    await expect(assertContactQuota("t1", 1)).resolves.toBeUndefined();
    expect(mocks.contactCount).not.toHaveBeenCalled();
  });

  it("no-ops when contactLimit is negative (treated as unlimited)", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      contactLimit: -1,
      campaignLimit: 10,
    });
    await expect(assertContactQuota("t1", 5)).resolves.toBeUndefined();
  });

  it("no-ops when addCount is 0 — short-circuits before any DB call", async () => {
    await expect(assertContactQuota("t1", 0)).resolves.toBeUndefined();
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
  });

  it("allows the create when current + addCount stays at limit", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      contactLimit: 100,
      campaignLimit: 10,
    });
    mocks.contactCount.mockResolvedValue(99);
    await expect(assertContactQuota("t1", 1)).resolves.toBeUndefined();
  });

  it("rejects when current + addCount exceeds the limit by one", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      contactLimit: 100,
      campaignLimit: 10,
    });
    mocks.contactCount.mockResolvedValue(100);
    await expect(assertContactQuota("t1", 1)).rejects.toThrow(/Contact limit reached/);
  });

  it("rejects a bulk import that would blow past the limit", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      contactLimit: 1000,
      campaignLimit: 100,
    });
    mocks.contactCount.mockResolvedValue(900);
    // 900 + 200 = 1100 > 1000, reject before createMany fires
    await expect(assertContactQuota("t1", 200)).rejects.toThrow(/Contact limit reached/);
  });

  it("error includes the count + limit in the message for operator clarity", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      contactLimit: 50,
      campaignLimit: 5,
    });
    mocks.contactCount.mockResolvedValue(50);
    await expect(assertContactQuota("t1", 1)).rejects.toThrow(/50\/50/);
  });
});

describe("assertCampaignQuota", () => {
  it("no-ops on missing tenant", async () => {
    mocks.tenantFindUnique.mockResolvedValue(null);
    await expect(assertCampaignQuota("t1")).resolves.toBeUndefined();
  });

  it("no-ops on unlimited plan (limit <= 0)", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      contactLimit: 100,
      campaignLimit: 0,
    });
    await expect(assertCampaignQuota("t1")).resolves.toBeUndefined();
    expect(mocks.campaignCount).not.toHaveBeenCalled();
  });

  it("allows creation at limit-1", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      contactLimit: 100,
      campaignLimit: 10,
    });
    mocks.campaignCount.mockResolvedValue(9);
    await expect(assertCampaignQuota("t1")).resolves.toBeUndefined();
  });

  it("rejects when at the limit (would be limit+1 after create)", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      contactLimit: 100,
      campaignLimit: 10,
    });
    mocks.campaignCount.mockResolvedValue(10);
    await expect(assertCampaignQuota("t1")).rejects.toThrow(/Campaign limit reached/);
  });

  it("rejects with a 402 status code via ApiError", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      contactLimit: 100,
      campaignLimit: 10,
    });
    mocks.campaignCount.mockResolvedValue(10);
    try {
      await assertCampaignQuota("t1");
      throw new Error("expected throw");
    } catch (err) {
      // Use unknown narrowing rather than assuming ApiError shape.
      const status = (err as { statusCode?: number }).statusCode;
      expect(status).toBe(402);
    }
  });
});
