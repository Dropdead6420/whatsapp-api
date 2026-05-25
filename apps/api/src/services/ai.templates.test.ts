import { beforeEach, describe, expect, it, vi } from "vitest";

// T-055: tests for the WhatsApp template generation + approval prediction
// helpers. Anthropic SDK + billing are mocked the same way as the rest of
// ai.service's tests.

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  aiUsageCreate: vi.fn(),
  assertCanAffordAi: vi.fn(),
  debitAi: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mocks.anthropicCreate },
  })),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    aiUsage: { create: mocks.aiUsageCreate },
  },
}));

vi.mock("./billing.service", () => ({
  assertCanAffordAi: mocks.assertCanAffordAi,
  debitAi: mocks.debitAi,
}));

function modelReply(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    usage: { input_tokens: 100, output_tokens: 100 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-real";
  mocks.assertCanAffordAi.mockResolvedValue(undefined);
  mocks.debitAi.mockResolvedValue(undefined);
  mocks.aiUsageCreate.mockResolvedValue({ id: "usage_1" });
});

describe("generateWhatsAppTemplate", () => {
  it("returns up to 3 variants and clamps oversized fields", async () => {
    const longHeader = "h".repeat(80);
    const longBody = "b".repeat(1100);
    mocks.anthropicCreate.mockResolvedValue(
      modelReply({
        variants: [
          {
            headerText: longHeader,
            bodyText: longBody,
            footerText: "f",
            rationale: "v1",
          },
          {
            headerText: null,
            bodyText: "second variant body",
            footerText: null,
            rationale: "v2",
          },
          {
            headerText: "Hi",
            bodyText: "third variant body",
            footerText: "footer",
            rationale: "v3",
          },
        ],
      }),
    );

    const { generateWhatsAppTemplate } = await import("./ai.service");
    const out = await generateWhatsAppTemplate("tenant_1", {
      industry: "scrubs retail",
      goal: "announce 20% off",
    });

    expect(out).toHaveLength(3);
    // Header was 80 chars; clamped to 60 with ellipsis
    expect(out[0].headerText).not.toBeNull();
    expect(out[0].headerText!.length).toBe(60);
    expect(out[0].headerText!.endsWith("…")).toBe(true);
    // Body was 1100; clamped to 1024
    expect(out[0].bodyText.length).toBe(1024);
    // Variant 2 with null header/footer is preserved
    expect(out[1].headerText).toBeNull();
    expect(out[1].footerText).toBeNull();
    expect(out[2].headerText).toBe("Hi");
  });

  it("skips variants without a body and caps to 3", async () => {
    mocks.anthropicCreate.mockResolvedValue(
      modelReply({
        variants: [
          { bodyText: "ok 1", rationale: "" },
          { bodyText: "", rationale: "skipped" }, // no body - drop
          { bodyText: "ok 2", rationale: "" },
          { bodyText: "ok 3", rationale: "" },
          { bodyText: "ok 4 extra", rationale: "extra" }, // over the cap of 3
        ],
      }),
    );
    const { generateWhatsAppTemplate } = await import("./ai.service");
    const out = await generateWhatsAppTemplate("tenant_1", {
      industry: "X",
      goal: "Y",
    });
    expect(out).toHaveLength(3);
    expect(out.map((v) => v.bodyText)).toEqual(["ok 1", "ok 2", "ok 3"]);
  });

  it("returns [] when the model returns no variants", async () => {
    mocks.anthropicCreate.mockResolvedValue(modelReply({ variants: [] }));
    const { generateWhatsAppTemplate } = await import("./ai.service");
    const out = await generateWhatsAppTemplate("tenant_1", {
      industry: "X",
      goal: "Y",
    });
    expect(out).toEqual([]);
  });

  it("debits wallet on success", async () => {
    mocks.anthropicCreate.mockResolvedValue(
      modelReply({ variants: [{ bodyText: "ok", rationale: "" }] }),
    );
    const { generateWhatsAppTemplate } = await import("./ai.service");
    await generateWhatsAppTemplate("tenant_1", { industry: "X", goal: "Y" });
    expect(mocks.assertCanAffordAi).toHaveBeenCalledWith(
      "tenant_1",
      "template_ai_generate",
    );
    expect(mocks.debitAi).toHaveBeenCalledTimes(1);
  });
});

describe("predictTemplateApproval", () => {
  it("fast-fails empty body without calling the LLM", async () => {
    const { predictTemplateApproval } = await import("./ai.service");
    const out = await predictTemplateApproval("tenant_1", {
      category: "MARKETING",
      bodyText: "   ",
    });
    expect(out.score).toBe(0);
    expect(out.verdict).toBe("likely_reject");
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
  });

  it("fast-fails when body exceeds Meta's 1024 char limit", async () => {
    const { predictTemplateApproval } = await import("./ai.service");
    const out = await predictTemplateApproval("tenant_1", {
      category: "MARKETING",
      bodyText: "x".repeat(1100),
    });
    expect(out.verdict).toBe("likely_reject");
    expect(out.reasons[0]).toMatch(/exceeds 1024/);
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
  });

  it("snaps verdict from score: 0.8 -> likely_approve", async () => {
    mocks.anthropicCreate.mockResolvedValue(
      modelReply({
        score: 0.82,
        verdict: "uncertain", // inconsistent — service overrides from score
        reasons: ["clean utility wording"],
      }),
    );
    const { predictTemplateApproval } = await import("./ai.service");
    const out = await predictTemplateApproval("tenant_1", {
      category: "UTILITY",
      bodyText: "Your order #12345 has shipped.",
    });
    expect(out.verdict).toBe("likely_approve");
    expect(out.score).toBe(0.82);
  });

  it("snaps verdict 0.3 -> likely_reject and synthesizes a reason when missing", async () => {
    mocks.anthropicCreate.mockResolvedValue(
      modelReply({ score: 0.3, verdict: "likely_reject", reasons: [] }),
    );
    const { predictTemplateApproval } = await import("./ai.service");
    const out = await predictTemplateApproval("tenant_1", {
      category: "MARKETING",
      bodyText: "BUY NOW LIMITED TIME OFFER CLICK HERE",
    });
    expect(out.verdict).toBe("likely_reject");
    expect(out.reasons.length).toBeGreaterThan(0);
    expect(out.reasons[0]).toMatch(/articulate|review/i);
  });

  it("snaps mid-range 0.55 to uncertain", async () => {
    mocks.anthropicCreate.mockResolvedValue(
      modelReply({
        score: 0.55,
        verdict: "likely_approve",
        reasons: ["category ambiguity"],
      }),
    );
    const { predictTemplateApproval } = await import("./ai.service");
    const out = await predictTemplateApproval("tenant_1", {
      category: "MARKETING",
      bodyText: "Special prices for VIPs this week.",
    });
    expect(out.verdict).toBe("uncertain");
    expect(out.score).toBe(0.55);
  });

  it("clamps a model-returned score above 1", async () => {
    mocks.anthropicCreate.mockResolvedValue(
      modelReply({ score: 1.5, verdict: "likely_approve", reasons: ["x"] }),
    );
    const { predictTemplateApproval } = await import("./ai.service");
    const out = await predictTemplateApproval("tenant_1", {
      category: "AUTHENTICATION",
      bodyText: "Your code is 123456.",
    });
    expect(out.score).toBe(1);
    expect(out.verdict).toBe("likely_approve");
  });

  it("debits wallet on the predict path too", async () => {
    mocks.anthropicCreate.mockResolvedValue(
      modelReply({ score: 0.9, verdict: "likely_approve", reasons: [] }),
    );
    const { predictTemplateApproval } = await import("./ai.service");
    await predictTemplateApproval("tenant_1", {
      category: "MARKETING",
      bodyText: "ok",
    });
    expect(mocks.assertCanAffordAi).toHaveBeenCalledWith(
      "tenant_1",
      "template_ai_predict_approval",
    );
    expect(mocks.debitAi).toHaveBeenCalledTimes(1);
  });
});
