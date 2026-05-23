import { beforeEach, describe, expect, it, vi } from "vitest";

// T-052 slice 3 — AI_AGENT flow node. We mock the runner + tool
// dispatcher and assert the node:
//   - Builds the conversation snapshot from prisma.message (or trigger
//     text when no conversation).
//   - Calls runAgent with the right shape.
//   - On ok: writes reply/citations/etc to vars + goes to node.next.
//   - On escalated: goes to node.branches.escalated || node.next.
//   - Dispatches each toolCall through dispatchAgentTool, accumulates
//     results into aiAgentToolResults var.
//   - Soft-skips with skipped trail when config is missing or there
//     are no messages to send.

const mocks = vi.hoisted(() => ({
  messageFindMany: vi.fn(),
  runAgent: vi.fn(),
  dispatchAgentTool: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: { message: { findMany: mocks.messageFindMany } },
}));

vi.mock("./aiAgentRunner.service", () => ({
  runAgent: mocks.runAgent,
  // The type is re-exported but never directly used at runtime.
  AgentConversationMessage: undefined,
}));

vi.mock("./aiAgentTool.service", () => ({
  dispatchAgentTool: mocks.dispatchAgentTool,
  ToolDispatchResult: undefined,
}));

// Stub the *other* deps of ai.service.ts so the module loads — none of
// them actually run in these tests.
vi.mock("./ai.service", () => ({
  classifyIntent: vi.fn(),
  extractStructuredData: vi.fn(),
  runTenantLlmJson: vi.fn(),
  summarizeConversation: vi.fn(),
}));

import { aiFlowNodeHandlers } from "./flow/aiNodes";
import type { FlowExecutionContext, FlowNode } from "./flow/types";

const AI_AGENT = aiFlowNodeHandlers.AI_AGENT;
if (!AI_AGENT) throw new Error("AI_AGENT handler not registered");

function baseCtx(overrides: Partial<FlowExecutionContext> = {}): FlowExecutionContext {
  return {
    tenantId: "tenant_1",
    flowId: "flow_1",
    runId: "run_1",
    contactId: "contact_1",
    conversationId: "conv_1",
    vars: {},
    triggerText: "hello bot",
    ...overrides,
  };
}

function aiAgentNode(config: Record<string, unknown> = {}): FlowNode {
  return {
    id: "node_1",
    type: "AI_AGENT",
    config: { agentId: "agent_1", ...config },
    next: "node_next",
  };
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.messageFindMany.mockResolvedValue([]);
});

describe("flow AI_AGENT node", () => {
  it("soft-skips when agentId is missing from config (no LLM call)", async () => {
    const node: FlowNode = {
      id: "node_1",
      type: "AI_AGENT",
      config: {},
      next: "node_next",
    };
    const result = await AI_AGENT.run(node, baseCtx());
    expect(result.nextNodeId).toBe("node_next");
    expect(result.trail).toMatchObject({ skipped: expect.stringMatching(/agentId/) });
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("builds the conversation from prisma.message in chronological order (reverse of desc query)", async () => {
    mocks.messageFindMany.mockResolvedValue([
      { direction: "OUTBOUND", content: "msg3" },
      { direction: "INBOUND", content: "msg2" },
      { direction: "INBOUND", content: "msg1" },
    ]);
    mocks.runAgent.mockResolvedValue({
      reply: "hi back",
      toolCalls: [],
      citations: [],
      escalated: false,
      escalationBehavior: null,
      modelUsed: "claude-3-5-haiku-latest",
      providerUsed: "anthropic",
      reason: "ok",
    });

    await AI_AGENT.run(aiAgentNode(), baseCtx());

    const calledWith = mocks.runAgent.mock.calls[0][0];
    expect(calledWith.tenantId).toBe("tenant_1");
    expect(calledWith.agentId).toBe("agent_1");
    expect(calledWith.conversation).toEqual([
      { role: "user", content: "msg1" }, // chronological after reverse
      { role: "user", content: "msg2" },
      { role: "assistant", content: "msg3" },
    ]);
  });

  it("uses triggerText when no conversation in context", async () => {
    mocks.runAgent.mockResolvedValue({
      reply: "hi",
      toolCalls: [],
      citations: [],
      escalated: false,
      escalationBehavior: null,
      modelUsed: "m",
      providerUsed: "anthropic",
      reason: "ok",
    });
    await AI_AGENT.run(aiAgentNode(), baseCtx({ conversationId: null }));
    expect(mocks.messageFindMany).not.toHaveBeenCalled();
    expect(mocks.runAgent.mock.calls[0][0].conversation).toEqual([
      { role: "user", content: "hello bot" },
    ]);
  });

  it("happy path: writes reply + citations to vars and goes to node.next", async () => {
    mocks.runAgent.mockResolvedValue({
      reply: "We're open 9-5",
      toolCalls: [],
      citations: [
        { entryId: "kb_1", title: "Hours", category: "HOURS", score: 0.9, snippet: "9-5" },
      ],
      escalated: false,
      escalationBehavior: null,
      modelUsed: "claude-3-5-haiku-latest",
      providerUsed: "anthropic",
      reason: "ok",
    });
    mocks.messageFindMany.mockResolvedValue([
      { direction: "INBOUND", content: "what hours" },
    ]);

    const out = await AI_AGENT.run(aiAgentNode(), baseCtx());

    expect(out.nextNodeId).toBe("node_next");
    expect(out.vars).toMatchObject({
      aiAgentReply: "We're open 9-5",
      aiAgentReason: "ok",
      aiAgentEscalated: false,
      aiAgentProviderUsed: "anthropic",
    });
    expect((out.vars?.aiAgentCitations as unknown[]).length).toBe(1);
  });

  it("escalation: goes to node.branches.escalated when set", async () => {
    mocks.runAgent.mockResolvedValue({
      reply: null,
      toolCalls: [],
      citations: [],
      escalated: true,
      escalationBehavior: "ESCALATE_TO_HUMAN",
      modelUsed: null,
      providerUsed: null,
      reason: "fallback_no_active_agent",
    });
    mocks.messageFindMany.mockResolvedValue([
      { direction: "INBOUND", content: "hi" },
    ]);

    const node: FlowNode = {
      id: "node_1",
      type: "AI_AGENT",
      config: { agentId: "agent_1" },
      next: "node_next",
      branches: { escalated: "node_human" },
    };
    const out = await AI_AGENT.run(node, baseCtx());

    expect(out.nextNodeId).toBe("node_human");
    expect(out.vars?.aiAgentEscalated).toBe(true);
    expect(out.vars?.aiAgentReply).toBe(""); // empty string, not null, so MESSAGE node soft-skips cleanly
  });

  it("escalation falls back to node.next when no `escalated` branch exists", async () => {
    mocks.runAgent.mockResolvedValue({
      reply: null,
      toolCalls: [],
      citations: [],
      escalated: true,
      escalationBehavior: "SILENT",
      modelUsed: null,
      providerUsed: null,
      reason: "fallback_llm_error",
    });
    mocks.messageFindMany.mockResolvedValue([
      { direction: "INBOUND", content: "hi" },
    ]);
    const out = await AI_AGENT.run(aiAgentNode(), baseCtx());
    expect(out.nextNodeId).toBe("node_next");
  });

  it("dispatches each toolCall and accumulates results in aiAgentToolResults", async () => {
    mocks.runAgent.mockResolvedValue({
      reply: null,
      toolCalls: [
        { tool: "CREATE_LEAD", arguments: { title: "Sid interested" } },
        { tool: "ADD_TAG", arguments: { tag: "lead" } },
      ],
      citations: [],
      escalated: false,
      escalationBehavior: null,
      modelUsed: "m",
      providerUsed: "anthropic",
      reason: "ok",
    });
    mocks.messageFindMany.mockResolvedValue([
      { direction: "INBOUND", content: "I want pricing" },
    ]);
    mocks.dispatchAgentTool
      .mockResolvedValueOnce({ ok: true, tool: "CREATE_LEAD", result: { leadId: "lead_1" } })
      .mockResolvedValueOnce({ ok: true, tool: "ADD_TAG", result: { tag: "lead" } });

    const out = await AI_AGENT.run(aiAgentNode(), baseCtx());

    expect(mocks.dispatchAgentTool).toHaveBeenCalledTimes(2);
    // Both calls receive the same allowedTools derived from the run
    const firstCallCtx = mocks.dispatchAgentTool.mock.calls[0][0];
    expect(firstCallCtx.allowedTools.sort()).toEqual(["ADD_TAG", "CREATE_LEAD"]);
    expect((out.vars?.aiAgentToolResults as unknown[]).length).toBe(2);
    const trailToolCalls = (out.trail as { toolCalls: unknown[] }).toolCalls;
    expect(trailToolCalls).toEqual([
      { tool: "CREATE_LEAD", ok: true },
      { tool: "ADD_TAG", ok: true },
    ]);
  });

  it("tool dispatch failure surfaces in trail without blocking the run", async () => {
    mocks.runAgent.mockResolvedValue({
      reply: "ack",
      toolCalls: [{ tool: "BOOK_APPOINTMENT", arguments: { serviceId: "x" } }],
      citations: [],
      escalated: false,
      escalationBehavior: null,
      modelUsed: "m",
      providerUsed: "anthropic",
      reason: "ok",
    });
    mocks.messageFindMany.mockResolvedValue([
      { direction: "INBOUND", content: "book me" },
    ]);
    mocks.dispatchAgentTool.mockResolvedValue({
      ok: false,
      tool: "BOOK_APPOINTMENT",
      error: "Missing 'scheduledAt'",
    });
    const out = await AI_AGENT.run(aiAgentNode(), baseCtx());

    expect(out.nextNodeId).toBe("node_next"); // run continues
    const trailToolCalls = (out.trail as { toolCalls: { tool: string; ok: boolean; error?: string }[] }).toolCalls;
    expect(trailToolCalls[0]).toMatchObject({
      tool: "BOOK_APPOINTMENT",
      ok: false,
      error: "Missing 'scheduledAt'",
    });
  });

  it("soft-skips with fallback_empty_user_message when no conversation AND no triggerText", async () => {
    const out = await AI_AGENT.run(
      aiAgentNode(),
      baseCtx({ conversationId: null, triggerText: undefined }),
    );
    expect(out.nextNodeId).toBe("node_next");
    expect(out.vars?.aiAgentReason).toBe("fallback_empty_user_message");
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("honors custom replyVar / toolResultsVar / reasonVar from config", async () => {
    mocks.runAgent.mockResolvedValue({
      reply: "ok",
      toolCalls: [],
      citations: [],
      escalated: false,
      escalationBehavior: null,
      modelUsed: "m",
      providerUsed: "anthropic",
      reason: "ok",
    });
    mocks.messageFindMany.mockResolvedValue([
      { direction: "INBOUND", content: "ping" },
    ]);
    const node = aiAgentNode({
      replyVar: "draft",
      toolResultsVar: "actions",
      reasonVar: "lastReason",
    });
    const out = await AI_AGENT.run(node, baseCtx());
    expect(out.vars).toMatchObject({
      draft: "ok",
      actions: [],
      lastReason: "ok",
    });
  });
});
