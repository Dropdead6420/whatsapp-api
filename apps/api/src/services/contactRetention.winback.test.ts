import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contactFindFirst: vi.fn(),
  runTenantLlmJson: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    contact: { findFirst: mocks.contactFindFirst },
  },
  Prisma: {},
  RetentionTier: {
    ACTIVE: "ACTIVE",
    COOLING: "COOLING",
    DORMANT: "DORMANT",
    LOST: "LOST",
  },
  RetentionMode: {
    MANUAL: "MANUAL",
    ASSISTED: "ASSISTED",
    AUTOPILOT: "AUTOPILOT",
  },
  DripSequenceStatus: { DRAFT: "DRAFT", ACTIVE: "ACTIVE", PAUSED: "PAUSED" },
  LifecycleStage: {
    LEAD: "LEAD",
    PROSPECT: "PROSPECT",
    CUSTOMER: "CUSTOMER",
    REPEAT_CUSTOMER: "REPEAT_CUSTOMER",
    VIP: "VIP",
    CHURNED: "CHURNED",
  },
}));

vi.mock("./ai.service", () => ({
  runTenantLlmJson: mocks.runTenantLlmJson,
}));

import { generateWinbackCopy } from "./contactRetention.service";

const baseContact = {
  id: "c1",
  name: "Priya Sharma",
  lifecycleStage: "CUSTOMER",
  optedOut: false,
  aiScore: 0.6,
  lastInteractionAt: new Date(Date.now() - 45 * 86_400_000),
  createdAt: new Date(Date.now() - 90 * 86_400_000),
  tags: ["vip"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateWinbackCopy", () => {
  it("returns an AI message on success and sanitizes variants", async () => {
    mocks.contactFindFirst.mockResolvedValue(baseContact);
    mocks.runTenantLlmJson.mockResolvedValue({
      message: "Hi Priya, we've missed you — anything we can help with?",
      variants: ["Hey Priya 👋", "Quick check-in!", ""],
    });

    const result = await generateWinbackCopy({
      tenantId: "t1",
      contactId: "c1",
    });

    expect(result.source).toBe("ai");
    expect(result.message).toContain("Priya");
    expect(result.variants).toHaveLength(2); // empty filtered out
    expect(mocks.runTenantLlmJson).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        feature: "retention_winback_copy",
      }),
    );
  });

  it("rejects an opted-out contact with 400 and never calls the LLM", async () => {
    mocks.contactFindFirst.mockResolvedValue({ ...baseContact, optedOut: true });

    await expect(
      generateWinbackCopy({ tenantId: "t1", contactId: "c1" }),
    ).rejects.toThrow(/opted out/i);
    expect(mocks.runTenantLlmJson).not.toHaveBeenCalled();
  });

  it("404s when the contact is not in the tenant", async () => {
    mocks.contactFindFirst.mockResolvedValue(null);

    await expect(
      generateWinbackCopy({ tenantId: "t1", contactId: "c_missing" }),
    ).rejects.toThrow(/not found/i);
    expect(mocks.contactFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c_missing", tenantId: "t1" },
      }),
    );
  });

  it("falls back to deterministic copy when the LLM throws", async () => {
    mocks.contactFindFirst.mockResolvedValue(baseContact);
    mocks.runTenantLlmJson.mockRejectedValue(new Error("no api key"));

    const result = await generateWinbackCopy({
      tenantId: "t1",
      contactId: "c1",
    });

    expect(result.source).toBe("fallback");
    expect(result.message).toContain("Priya");
    expect(result.variants.length).toBeGreaterThan(0);
  });

  it("falls back when the LLM returns an empty message and no variants", async () => {
    mocks.contactFindFirst.mockResolvedValue(baseContact);
    mocks.runTenantLlmJson.mockResolvedValue({});

    const result = await generateWinbackCopy({
      tenantId: "t1",
      contactId: "c1",
    });

    expect(result.source).toBe("fallback");
  });

  it("promotes the first variant to message when LLM only returns variants", async () => {
    mocks.contactFindFirst.mockResolvedValue(baseContact);
    mocks.runTenantLlmJson.mockResolvedValue({
      variants: ["Variant A", "Variant B"],
    });

    const result = await generateWinbackCopy({
      tenantId: "t1",
      contactId: "c1",
    });

    expect(result.source).toBe("ai");
    expect(result.message).toBe("Variant A");
    expect(result.variants).toEqual(["Variant B"]);
  });
});
