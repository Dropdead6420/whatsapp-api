import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  aiUsageCreate: vi.fn(),
  assertCanAffordAi: vi.fn(),
  debitAi: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mocks.anthropicCreate,
    },
  })),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    aiUsage: {
      create: mocks.aiUsageCreate,
    },
  },
}));

vi.mock("./billing.service", () => ({
  assertCanAffordAi: mocks.assertCanAffordAi,
  debitAi: mocks.debitAi,
}));

describe("ai.service wallet billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mocks.assertCanAffordAi.mockResolvedValue(undefined);
    mocks.debitAi.mockResolvedValue(undefined);
    mocks.aiUsageCreate.mockResolvedValue({ id: "usage_1" });
  });

  it("pre-checks the wallet, logs usage, and debits after a successful AI call", async () => {
    mocks.anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            reasoning: "Matched known customer tag.",
            tagsAny: ["vip"],
            optedOut: false,
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const { describeSegmentFilter } = await import("./ai.service");
    const result = await describeSegmentFilter("tenant_1", "VIP customers", [
      "vip",
    ]);

    expect(result.tagsAny).toEqual(["vip"]);
    expect(mocks.assertCanAffordAi).toHaveBeenCalledWith(
      "tenant_1",
      "smart_segmentation",
    );
    expect(mocks.aiUsageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant_1",
        feature: "smart_segmentation",
        inputTokens: 100,
        outputTokens: 20,
      }),
    });
    expect(mocks.debitAi).toHaveBeenCalledWith("tenant_1", {
      aiUsageId: "usage_1",
      feature: "smart_segmentation",
      reason: "AI call (smart_segmentation)",
    });
    expect(
      mocks.assertCanAffordAi.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.anthropicCreate.mock.invocationCallOrder[0]);
    expect(mocks.aiUsageCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.debitAi.mock.invocationCallOrder[0],
    );
  });

  it("does not log usage or debit when the provider call fails", async () => {
    mocks.anthropicCreate.mockRejectedValue(new Error("provider down"));

    const { describeSegmentFilter } = await import("./ai.service");

    await expect(
      describeSegmentFilter("tenant_1", "VIP customers", ["vip"]),
    ).rejects.toThrow("provider down");

    expect(mocks.assertCanAffordAi).toHaveBeenCalledWith(
      "tenant_1",
      "smart_segmentation",
    );
    expect(mocks.aiUsageCreate).not.toHaveBeenCalled();
    expect(mocks.debitAi).not.toHaveBeenCalled();
  });
});
