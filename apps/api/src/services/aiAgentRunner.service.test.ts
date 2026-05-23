import { beforeEach, describe, expect, it, vi } from "vitest";

// ----- mocks --------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  aiAgentFindFirst: vi.fn(),
  aiUsageCreate: vi.fn(),
  retrieveKnowledge: vi.fn(),
  assertCanAffordAi: vi.fn(),
  debitAi: vi.fn(),
  anthropicCreate: vi.fn(),
  openaiCreate: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    aiAgent: { findFirst: mocks.aiAgentFindFirst },
    aiUsage: { create: mocks.aiUsageCreate },
  },
}));

vi.mock("./knowledgeBaseEmbedding.service", () => ({
  retrieveKnowledge: mocks.retrieveKnowledge,
}));

vi.mock("./billing.service", () => ({
  assertCanAffordAi: mocks.assertCanAffordAi,
  debitAi: mocks.debitAi,
}));

// Anthropic + OpenAI SDKs are mocked at the constructor level so we
// don't need real API keys; pickProvider just sees a non-null client.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mocks.anthropicCreate };
  },
}));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: mocks.openaiCreate } };
  },
}));

import { runAgent, __test__ } from "./aiAgentRunner.service";

const baseAgent = {
  id: "agent_1",
  tenantId: "tenant_1",
  name: "Sales Bot",
  description: null,
  persona: "You are a friendly sales assistant. Be concise.",
  provider: "anthropic",
  model: "claude-3-5-haiku-latest",
  temperature: 0.5,
  maxTokens: 400,
  knowledgeScope: { categories: [], tags: [], topK: 3 },
  tools: [],
  fallbackBehavior: "ESCALATE_TO_HUMAN",
  fallbackTemplateId: null,
  isDefault: false,
  status: "ACTIVE",
  publishedAt: new Date(),
  disabledAt: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  // Default — make both provider clients appear configured. Individual
  // tests can override by setting env vars or by clearing the mock.
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-real";
  process.env.OPENAI_API_KEY = "sk-test-real-openai";
  mocks.retrieveKnowledge.mockResolvedValue({
    query: "",
    embeddingModel: "local-hash-v1",
    results: [],
  });
  mocks.assertCanAffordAi.mockResolvedValue(undefined);
  mocks.aiUsageCreate.mockResolvedValue({ id: "usage_1" });
  mocks.debitAi.mockResolvedValue(undefined);
});

// --------------------------------------------------------------------------
// runAgent — end-to-end paths
// --------------------------------------------------------------------------

describe("aiAgentRunner.runAgent", () => {
  it("404s when the agent id doesn't belong to the tenant", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue(null);
    await expect(
      runAgent({
        tenantId: "tenant_1",
        agentId: "agent_X",
        conversation: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/AI agent not found/);
  });

  it("escalates without LLM call when the agent isn't ACTIVE", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue({ ...baseAgent, status: "DRAFT" });
    const out = await runAgent({
      tenantId: "tenant_1",
      agentId: "agent_1",
      conversation: [{ role: "user", content: "hi" }],
    });
    expect(out.escalated).toBe(true);
    expect(out.reason).toBe("fallback_no_active_agent");
    expect(out.reply).toBeNull();
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
    expect(mocks.openaiCreate).not.toHaveBeenCalled();
  });

  it("escalates on empty user message without calling the LLM", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue(baseAgent);
    const out = await runAgent({
      tenantId: "tenant_1",
      agentId: "agent_1",
      conversation: [{ role: "assistant", content: "hello" }],
    });
    expect(out.escalated).toBe(true);
    expect(out.reason).toBe("fallback_empty_user_message");
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
  });

  it("escalates when neither provider has a usable API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    mocks.aiAgentFindFirst.mockResolvedValue(baseAgent);
    const out = await runAgent({
      tenantId: "tenant_1",
      agentId: "agent_1",
      conversation: [{ role: "user", content: "hi" }],
    });
    expect(out.escalated).toBe(true);
    expect(out.reason).toBe("fallback_no_llm_configured");
    expect(out.escalationBehavior).toBe("ESCALATE_TO_HUMAN");
  });

  it("happy path: retrieves KB, calls Anthropic, debits wallet, returns reply + citations", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue(baseAgent);
    mocks.retrieveKnowledge.mockResolvedValue({
      query: "what are your hours",
      embeddingModel: "local-hash-v1",
      results: [
        {
          id: "kb_1",
          title: "Store Hours",
          summary: "Mon-Fri 9-5",
          content: "We are open Monday through Friday from 9am to 5pm.",
          category: "HOURS",
          tags: [],
          score: 0.92,
          scoreSource: "lexical",
          snippet: "open Monday through Friday from 9am to 5pm",
          embeddingModel: null,
          lastEmbeddedAt: null,
        },
      ],
    });
    mocks.anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "We're open 9-5, Mon-Fri [KB-1]." }],
      usage: { input_tokens: 120, output_tokens: 18 },
    });

    const out = await runAgent({
      tenantId: "tenant_1",
      agentId: "agent_1",
      conversation: [{ role: "user", content: "what are your hours?" }],
    });

    expect(out.escalated).toBe(false);
    expect(out.reply).toContain("9-5");
    expect(out.providerUsed).toBe("anthropic");
    expect(out.modelUsed).toBe("claude-3-5-haiku-latest");
    expect(out.citations).toHaveLength(1);
    expect(out.citations[0].entryId).toBe("kb_1");

    // Wallet bookkeeping happened
    expect(mocks.assertCanAffordAi).toHaveBeenCalledWith(
      "tenant_1",
      "ai_agent:agent_1",
    );
    expect(mocks.aiUsageCreate).toHaveBeenCalledTimes(1);
    expect(mocks.debitAi).toHaveBeenCalledTimes(1);

    // KB instructions made it into the system prompt
    const systemPrompt = mocks.anthropicCreate.mock.calls[0][0].system as string;
    expect(systemPrompt).toContain("[KB-1]");
    expect(systemPrompt).toContain("Store Hours");
  });

  it("escalates on LLM error and skips wallet debit", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue(baseAgent);
    mocks.anthropicCreate.mockRejectedValue(new Error("anthropic 503"));
    const out = await runAgent({
      tenantId: "tenant_1",
      agentId: "agent_1",
      conversation: [{ role: "user", content: "hi" }],
    });
    expect(out.escalated).toBe(true);
    expect(out.reason).toBe("fallback_llm_error");
    // assertCanAffordAi was called BEFORE the LLM, but the post-call
    // debit must NOT fire on error — operators shouldn't pay for an
    // outage on Anthropic's side.
    expect(mocks.debitAi).not.toHaveBeenCalled();
  });

  it("falls back from openai provider to anthropic when the openai key isn't set", async () => {
    delete process.env.OPENAI_API_KEY;
    mocks.aiAgentFindFirst.mockResolvedValue({
      ...baseAgent,
      provider: "openai",
      model: "gpt-4o-mini",
    });
    mocks.anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "Sure thing!" }],
      usage: { input_tokens: 50, output_tokens: 5 },
    });

    const out = await runAgent({
      tenantId: "tenant_1",
      agentId: "agent_1",
      conversation: [{ role: "user", content: "hi" }],
    });

    expect(out.providerUsed).toBe("anthropic");
    expect(out.modelUsed).toBe("claude-3-5-haiku-latest"); // fallback model
    expect(out.reply).toBe("Sure thing!");
  });

  it("extracts a tool call when the model returns JSON matching agent.tools", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue({
      ...baseAgent,
      tools: ["CREATE_LEAD"],
    });
    mocks.anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '{"tool":"CREATE_LEAD","arguments":{"name":"Sid","phone":"+91..."}}',
        },
      ],
      usage: { input_tokens: 80, output_tokens: 22 },
    });

    const out = await runAgent({
      tenantId: "tenant_1",
      agentId: "agent_1",
      conversation: [
        { role: "user", content: "I'm Sid, interested in pricing" },
      ],
    });

    expect(out.reply).toBeNull();
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0]).toEqual({
      tool: "CREATE_LEAD",
      arguments: { name: "Sid", phone: "+91..." },
    });
  });

  it("ignores tool JSON that names a tool NOT in the agent's allowlist", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue({
      ...baseAgent,
      tools: ["ADD_TAG"], // CREATE_LEAD NOT allowed
    });
    mocks.anthropicCreate.mockResolvedValue({
      content: [
        { type: "text", text: '{"tool":"CREATE_LEAD","arguments":{}}' },
      ],
      usage: { input_tokens: 50, output_tokens: 10 },
    });

    const out = await runAgent({
      tenantId: "tenant_1",
      agentId: "agent_1",
      conversation: [{ role: "user", content: "hi" }],
    });

    // Tool was rejected; the raw JSON is returned as plain text so
    // the operator can see the model misbehaved (better than silently
    // swallowing it).
    expect(out.toolCalls).toHaveLength(0);
    expect(out.reply).toContain("CREATE_LEAD");
  });

  it("loops through multiple KB categories and merges results, then clamps to topK", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue({
      ...baseAgent,
      knowledgeScope: { categories: ["FAQ", "POLICY"], tags: [], topK: 3 },
    });
    mocks.retrieveKnowledge
      .mockResolvedValueOnce({
        query: "test",
        embeddingModel: "m",
        results: [
          { id: "f1", title: "FAQ 1", summary: null, content: "c", category: "FAQ", tags: [], score: 0.9, scoreSource: "lexical", snippet: "s", embeddingModel: null, lastEmbeddedAt: null },
          { id: "f2", title: "FAQ 2", summary: null, content: "c", category: "FAQ", tags: [], score: 0.6, scoreSource: "lexical", snippet: "s", embeddingModel: null, lastEmbeddedAt: null },
        ],
      })
      .mockResolvedValueOnce({
        query: "test",
        embeddingModel: "m",
        results: [
          { id: "p1", title: "Policy 1", summary: null, content: "c", category: "POLICY", tags: [], score: 0.95, scoreSource: "lexical", snippet: "s", embeddingModel: null, lastEmbeddedAt: null },
          { id: "p2", title: "Policy 2", summary: null, content: "c", category: "POLICY", tags: [], score: 0.5, scoreSource: "lexical", snippet: "s", embeddingModel: null, lastEmbeddedAt: null },
        ],
      });
    mocks.anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 10, output_tokens: 2 },
    });

    const out = await runAgent({
      tenantId: "tenant_1",
      agentId: "agent_1",
      conversation: [{ role: "user", content: "tell me" }],
    });

    expect(mocks.retrieveKnowledge).toHaveBeenCalledTimes(2);
    expect(out.citations.map((c) => c.entryId)).toEqual(["p1", "f1", "f2"]); // sorted by score desc, clamped to topK=3
  });

  it("continues with empty KB context when retrieveKnowledge throws", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue(baseAgent);
    mocks.retrieveKnowledge.mockRejectedValue(new Error("db blip"));
    mocks.anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "answer without KB" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const out = await runAgent({
      tenantId: "tenant_1",
      agentId: "agent_1",
      conversation: [{ role: "user", content: "anything" }],
    });

    expect(out.reply).toBe("answer without KB");
    expect(out.citations).toHaveLength(0);
    expect(out.escalated).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Unit tests — internal helpers
// --------------------------------------------------------------------------

describe("aiAgentRunner helpers", () => {
  it("lastUserMessage returns the most recent user turn, ignoring assistant ones", () => {
    const text = __test__.lastUserMessage([
      { role: "user", content: "first" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "second" },
      { role: "assistant", content: "ack" },
    ]);
    expect(text).toBe("second");
  });

  it("clampHistory keeps only the trailing MAX_HISTORY_MESSAGES entries", () => {
    const huge = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${i}`,
    }));
    const clamped = __test__.clampHistory(huge);
    expect(clamped).toHaveLength(12);
    expect(clamped[0].content).toBe("m8");
    expect(clamped[11].content).toBe("m19");
  });

  it("extractToolCallIfAny passes plain prose through when no tool JSON is present", () => {
    const out = __test__.extractToolCallIfAny(
      "Sure, our hours are 9-5.",
      ["CREATE_LEAD"],
    );
    expect(out.text).toContain("9-5");
    expect(out.toolCalls).toHaveLength(0);
  });

  it("extractToolCallIfAny unwraps fenced JSON blocks", () => {
    const out = __test__.extractToolCallIfAny(
      '```json\n{"tool":"CREATE_LEAD","arguments":{"name":"X"}}\n```',
      ["CREATE_LEAD"],
    );
    expect(out.text).toBeNull();
    expect(out.toolCalls[0].tool).toBe("CREATE_LEAD");
  });
});
