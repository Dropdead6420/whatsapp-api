import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-050 AI flow-node helpers — classifyIntent / summarizeConversation /
// extractStructuredData. All three call the private callLlmJson under the
// hood, so we mock the Anthropic SDK to assert the prompt shape + the
// post-processing guarantees (intent snap-to-allowed, null-on-missing,
// value coercion).

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  aiUsageCreate: vi.fn().mockResolvedValue({ id: "usage_1" }),
  debitAi: vi.fn().mockResolvedValue(undefined),
  assertCanAffordAi: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mocks.create };
  },
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

function jsonContent(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

describe("ai.service AI flow-node helpers", () => {
  const env = process.env;

  beforeEach(() => {
    mocks.create.mockReset();
    mocks.aiUsageCreate.mockClear();
    mocks.debitAi.mockClear();
    mocks.assertCanAffordAi.mockClear();
    process.env = {
      ...env,
      ANTHROPIC_API_KEY: "sk-test",
      AI_CALL_COST_CREDITS: "0",
    };
  });

  afterEach(() => {
    process.env = env;
  });

  // -- classifyIntent --------------------------------------------------------

  it("classifyIntent: snaps an out-of-list intent to 'unknown'", async () => {
    mocks.create.mockResolvedValue(
      jsonContent({ intent: "pizza", confidence: 0.9, reasoning: "n/a" }),
    );
    const { classifyIntent } = await import("./ai.service");
    const result = await classifyIntent("t_1", {
      text: "Want a haircut Friday",
      intents: ["pricing", "booking", "support"],
    });
    // "pizza" isn't in the allowed list — must collapse to "unknown".
    expect(result.intent).toBe("unknown");
    expect(result.confidence).toBe(0.9);
  });

  it("classifyIntent: returns 'unknown' on empty input without calling the model", async () => {
    const { classifyIntent } = await import("./ai.service");
    const result = await classifyIntent("t_1", {
      text: "   ",
      intents: ["foo"],
    });
    expect(result.intent).toBe("unknown");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("classifyIntent: rejects when intents list is empty", async () => {
    const { classifyIntent } = await import("./ai.service");
    await expect(
      classifyIntent("t_1", { text: "anything", intents: [] }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: /at least one intent/,
    });
  });

  it("classifyIntent: accepts valid in-list values", async () => {
    mocks.create.mockResolvedValue(
      jsonContent({
        intent: "booking",
        confidence: 0.84,
        reasoning: "Customer asks about a Friday slot.",
      }),
    );
    const { classifyIntent } = await import("./ai.service");
    const result = await classifyIntent("t_1", {
      text: "Want a haircut Friday",
      intents: ["pricing", "booking", "support"],
    });
    expect(result.intent).toBe("booking");
    expect(result.reasoning).toMatch(/Friday/);
  });

  // -- summarizeConversation -------------------------------------------------

  it("summarizeConversation: returns empty when no messages", async () => {
    const { summarizeConversation } = await import("./ai.service");
    const result = await summarizeConversation("t_1", { messages: [] });
    expect(result.summary).toBe("(no messages)");
    expect(result.bullets).toEqual([]);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("summarizeConversation: caps bullets at 7 + filters non-strings", async () => {
    mocks.create.mockResolvedValue(
      jsonContent({
        summary: "Customer asked about pricing.",
        bullets: [
          "Asked for the basic plan price",
          "Wants invoice by email",
          "",
          null,
          42,
          "Will confirm tomorrow",
          "Mentioned referral discount",
          "Considering annual plan",
          "Asked about cancellation policy",
          "Wants demo on Monday",
        ],
      }),
    );
    const { summarizeConversation } = await import("./ai.service");
    const result = await summarizeConversation("t_1", {
      messages: [
        { direction: "INBOUND", content: "How much is the plan?" },
        { direction: "OUTBOUND", content: "$29/mo." },
      ],
    });
    expect(result.summary).toBe("Customer asked about pricing.");
    expect(result.bullets).toHaveLength(7);
    // Non-strings stripped before count.
    expect(result.bullets.every((b) => typeof b === "string" && b.trim())).toBe(
      true,
    );
  });

  // -- extractStructuredData -------------------------------------------------

  it("extractStructuredData: coerces nulls + non-primitive values cleanly", async () => {
    mocks.create.mockResolvedValue(
      jsonContent({
        name: "Sid",
        email: null,
        phone: 919999999999, // number is OK
        notes: { foo: 1 }, // nested object → JSON-stringified
      }),
    );
    const { extractStructuredData } = await import("./ai.service");
    const result = await extractStructuredData("t_1", {
      text: "Hi I'm Sid",
      fields: {
        name: "Customer's name.",
        email: "Customer's email.",
        phone: "Customer's phone.",
        notes: "Anything else.",
      },
    });
    expect(result.name).toBe("Sid");
    expect(result.email).toBeNull();
    expect(result.phone).toBe(919999999999);
    expect(result.notes).toBe('{"foo":1}');
  });

  it("extractStructuredData: short-circuits to all-nulls on empty text", async () => {
    const { extractStructuredData } = await import("./ai.service");
    const result = await extractStructuredData("t_1", {
      text: "",
      fields: { name: "...", email: "..." },
    });
    expect(result).toEqual({ name: null, email: null });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("extractStructuredData: rejects when no fields are requested", async () => {
    const { extractStructuredData } = await import("./ai.service");
    await expect(
      extractStructuredData("t_1", { text: "anything", fields: {} }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: /at least one field/,
    });
  });

  // -- generateRecommendations -----------------------------------------------

  it("generateRecommendations: filters out ids not in the catalog (no inventing)", async () => {
    mocks.create.mockResolvedValue(
      jsonContent({
        recommendations: [
          { id: "service_haircut", name: "ignored", reasoning: "fits" },
          { id: "service_INVENTED", name: "x", reasoning: "fits" }, // not in catalog
          { id: "service_color", name: "y", reasoning: "fits" },
        ],
      }),
    );
    const { generateRecommendations } = await import("./ai.service");
    const result = await generateRecommendations("t_1", {
      context: "I want a haircut and color",
      items: [
        { id: "service_haircut", name: "Haircut" },
        { id: "service_color", name: "Hair Coloring" },
        { id: "service_massage", name: "Massage" },
      ],
    });
    expect(result.recommendations).toHaveLength(2);
    expect(result.recommendations.map((r) => r.id)).toEqual([
      "service_haircut",
      "service_color",
    ]);
    // Snap-to-catalog: name comes from the original item, not the model.
    expect(result.recommendations[0].name).toBe("Haircut");
  });

  it("generateRecommendations: empty catalog or empty context short-circuits", async () => {
    const { generateRecommendations } = await import("./ai.service");
    const a = await generateRecommendations("t_1", {
      context: "anything",
      items: [],
    });
    const b = await generateRecommendations("t_1", {
      context: "",
      items: [{ id: "x", name: "X" }],
    });
    expect(a.recommendations).toEqual([]);
    expect(b.recommendations).toEqual([]);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  // -- predictChurnRisk -----------------------------------------------------

  it("predictChurnRisk: opted-out short-circuits to high without LLM", async () => {
    const { predictChurnRisk } = await import("./ai.service");
    const result = await predictChurnRisk("t_1", {
      daysSinceLastInbound: 10,
      daysSinceLastOutbound: 5,
      totalInboundMessages: 3,
      totalOutboundMessages: 5,
      daysSinceCreated: 60,
      hasOpenLead: false,
      optedOut: true,
    });
    expect(result.riskScore).toBe(1);
    expect(result.riskBand).toBe("high");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("predictChurnRisk: brand-new contact short-circuits to medium baseline", async () => {
    const { predictChurnRisk } = await import("./ai.service");
    const result = await predictChurnRisk("t_1", {
      daysSinceLastInbound: null,
      daysSinceLastOutbound: null,
      totalInboundMessages: 0,
      totalOutboundMessages: 0,
      daysSinceCreated: 0,
      hasOpenLead: false,
      optedOut: false,
    });
    expect(result.riskBand).toBe("medium");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("predictChurnRisk: derives band from score correctly", async () => {
    mocks.create.mockResolvedValue(
      jsonContent({ riskScore: 0.8, reasoning: "Long silence, no open lead." }),
    );
    const { predictChurnRisk } = await import("./ai.service");
    const result = await predictChurnRisk("t_1", {
      daysSinceLastInbound: 45,
      daysSinceLastOutbound: 30,
      totalInboundMessages: 2,
      totalOutboundMessages: 4,
      daysSinceCreated: 120,
      hasOpenLead: false,
      optedOut: false,
    });
    expect(result.riskScore).toBe(0.8);
    expect(result.riskBand).toBe("high");
  });

  // -- routeBestAgent --------------------------------------------------------

  it("routeBestAgent: returns null when model picks an unknown agent id", async () => {
    mocks.create.mockResolvedValue(
      jsonContent({
        agentId: "user_ghost", // not in input list
        reasoning: "made-up",
      }),
    );
    const { routeBestAgent } = await import("./ai.service");
    const result = await routeBestAgent("t_1", {
      ticketText: "billing issue",
      agents: [
        { id: "user_a", name: "Alice" },
        { id: "user_b", name: "Bob" },
      ],
    });
    expect(result.agentId).toBeNull();
  });

  it("routeBestAgent: short-circuits to null when no candidates", async () => {
    const { routeBestAgent } = await import("./ai.service");
    const a = await routeBestAgent("t_1", { ticketText: "anything", agents: [] });
    const b = await routeBestAgent("t_1", {
      ticketText: "",
      agents: [{ id: "u_1", name: "X" }],
    });
    expect(a.agentId).toBeNull();
    expect(b.agentId).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("routeBestAgent: accepts a valid agent id from the list", async () => {
    mocks.create.mockResolvedValue(
      jsonContent({ agentId: "user_b", reasoning: "Bob handles billing." }),
    );
    const { routeBestAgent } = await import("./ai.service");
    const result = await routeBestAgent("t_1", {
      ticketText: "I have a billing issue.",
      agents: [
        { id: "user_a", name: "Alice", skills: ["sales"] },
        { id: "user_b", name: "Bob", skills: ["billing"] },
      ],
    });
    expect(result.agentId).toBe("user_b");
  });
});
