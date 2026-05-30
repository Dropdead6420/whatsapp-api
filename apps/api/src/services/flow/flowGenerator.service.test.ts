import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runTenantLlmJson: vi.fn(),
}));

vi.mock("../ai.service", () => ({
  runTenantLlmJson: mocks.runTenantLlmJson,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("flowGenerator.service", () => {
  it("creates a deterministic fallback flow without AI", async () => {
    const { generateFlowFromPrompt } = await import("./flowGenerator.service");

    const draft = await generateFlowFromPrompt({
      tenantId: "tenant_1",
      prompt: "When someone asks for pricing, reply and create a lead",
      useAi: false,
    });

    expect(draft.aiUsed).toBe(false);
    expect(draft.trigger).toBe("keyword");
    expect(draft.triggerKeywords).toContain("price");
    expect(draft.definition.nodes.map((node) => node.type)).toEqual([
      "START",
      "MESSAGE",
      "ADD_TAG",
      "CREATE_LEAD",
      "END",
    ]);
    expect(draft.definition.edges?.length).toBe(4);
    expect(mocks.runTenantLlmJson).not.toHaveBeenCalled();
  });

  it("normalizes a valid AI draft into supported flow nodes", async () => {
    mocks.runTenantLlmJson.mockResolvedValue({
      name: "VIP booking assistant",
      description: "Books VIP customers from WhatsApp.",
      trigger: "keyword",
      triggerKeywords: ["VIP", "Book!"],
      nodes: [
        { id: "start", type: "START", isEntry: true, config: {}, next: "reply" },
        {
          id: "reply",
          type: "MESSAGE",
          config: { text: "Hi VIP customer, what time works for you?" },
          next: "tag",
        },
        { id: "unsupported", type: "RUN_SHELL", config: {}, next: "done" },
        { id: "tag", type: "ADD_TAG", config: { tag: "VIP Lead" }, next: "done" },
      ],
    });

    const { generateFlowFromPrompt } = await import("./flowGenerator.service");
    const draft = await generateFlowFromPrompt({
      tenantId: "tenant_1",
      prompt: "If a VIP wants to book, reply and tag them",
    });

    expect(draft.aiUsed).toBe(true);
    expect(draft.name).toBe("VIP booking assistant");
    expect(draft.triggerKeywords).toEqual(["vip", "book"]);
    expect(draft.definition.nodes.some((node) => node.type === "RUN_SHELL")).toBe(false);
    expect(draft.definition.nodes.at(-1)?.type).toBe("END");
    expect(draft.definition.nodes.find((node) => node.id === "tag")?.config).toEqual({
      tag: "vip_lead",
    });
  });

  it("falls back to deterministic generation when AI is unavailable", async () => {
    mocks.runTenantLlmJson.mockRejectedValue(new Error("ANTHROPIC_API_KEY missing"));

    const { generateFlowFromPrompt } = await import("./flowGenerator.service");
    const draft = await generateFlowFromPrompt({
      tenantId: "tenant_1",
      prompt: "When someone asks for support, reply and tag help request",
      useAi: true,
    });

    expect(draft.aiUsed).toBe(false);
    expect(draft.aiFallbackReason).toContain("ANTHROPIC_API_KEY");
    expect(draft.triggerKeywords).toContain("help");
    expect(draft.definition.nodes.map((node) => node.type)).toContain("MESSAGE");
  });
});
