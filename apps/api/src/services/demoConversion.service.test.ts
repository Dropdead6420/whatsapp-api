import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  demoFindFirst: vi.fn(),
  messageCount: vi.fn(),
  runTenantLlmJson: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    demoTenant: {
      findFirst: mocks.demoFindFirst,
    },
    message: {
      count: mocks.messageCount,
    },
  },
}));

vi.mock("./ai.service", () => ({
  runTenantLlmJson: mocks.runTenantLlmJson,
}));

const baseDemo = {
  id: "demo_1",
  tenantId: "tenant_demo",
  createdByPartnerId: "partner_1",
  expiresAt: new Date(Date.now() + 3 * 86_400_000),
  tenant: {
    id: "tenant_demo",
    name: "PixelCraft Demo",
    createdAt: new Date(Date.now() - 12 * 86_400_000),
    _count: {
      contacts: 12,
      users: 2,
      campaigns: 1,
      whatsappTemplates: 1,
      leads: 1,
      conversations: 1,
      appointments: 0,
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demoFindFirst.mockResolvedValue(baseDemo);
  mocks.messageCount
    .mockResolvedValueOnce(8)
    .mockResolvedValueOnce(3)
    .mockResolvedValueOnce(5);
});

describe("demoConversion.service", () => {
  it("returns a deterministic conversion recommendation from demo engagement", async () => {
    const { recommendDemoConversion } = await import("./demoConversion.service");

    const rec = await recommendDemoConversion({
      partnerTenantId: "partner_1",
      demoId: "demo_1",
      useAi: false,
    });

    expect(rec.demoId).toBe("demo_1");
    expect(rec.score).toBeGreaterThanOrEqual(70);
    expect(rec.stage).toBe("HOT");
    expect(rec.recommendedAction).toBe("CONVERT_NOW");
    expect(rec.signals.messages).toBe(8);
    expect(mocks.runTenantLlmJson).not.toHaveBeenCalled();
    expect(mocks.demoFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "demo_1", createdByPartnerId: "partner_1" },
      }),
    );
  });

  it("uses AI output when available but keeps deterministic signals", async () => {
    mocks.runTenantLlmJson.mockResolvedValue({
      score: 66,
      recommendedAction: "SCHEDULE_CALL",
      subject: "Book the rollout call",
      message: "Your demo has traction. Let's map the paid rollout.",
      reasoning: "Campaign and message activity indicate a warm account.",
    });

    const { recommendDemoConversion } = await import("./demoConversion.service");
    const rec = await recommendDemoConversion({
      partnerTenantId: "partner_1",
      demoId: "demo_1",
      useAi: true,
    });

    expect(rec.aiUsed).toBe(true);
    expect(rec.score).toBe(66);
    expect(rec.stage).toBe("WARM");
    expect(rec.recommendedAction).toBe("SCHEDULE_CALL");
    expect(rec.signals.contacts).toBe(12);
  });

  it("falls back gracefully when the AI call fails", async () => {
    mocks.runTenantLlmJson.mockRejectedValue(new Error("ANTHROPIC_API_KEY missing"));

    const { recommendDemoConversion } = await import("./demoConversion.service");
    const rec = await recommendDemoConversion({
      partnerTenantId: "partner_1",
      demoId: "demo_1",
      useAi: true,
    });

    expect(rec.aiUsed).toBe(false);
    expect(rec.aiFallbackReason).toContain("ANTHROPIC_API_KEY");
    expect(rec.recommendedAction).toBe("CONVERT_NOW");
  });

  it("refuses demos outside the partner tenant", async () => {
    mocks.demoFindFirst.mockResolvedValueOnce(null);
    const { recommendDemoConversion } = await import("./demoConversion.service");

    await expect(
      recommendDemoConversion({
        partnerTenantId: "other_partner",
        demoId: "demo_1",
        useAi: false,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
