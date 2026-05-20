import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression tests for the AI_SUMMARIZE handler (T-050).
//
// The bug: the first version queried `orderBy: createdAt asc, take: 40`,
// which returns the OLDEST messages from a long conversation. The agent
// handoff use case needs the LAST 40 messages — the recent context, not
// the greeting from six months ago.
//
// The fix below uses desc + take, then reverse(). These tests assert
// both pieces:
//   1. The prisma query is `desc` (so the take selects the newest rows).
//   2. The handler passes the messages to summarizeConversation in
//      chronological order (oldest first), so the prompt isn't backwards.

const mocks = vi.hoisted(() => ({
  messageFindMany: vi.fn(),
  summarizeConversation: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    message: { findMany: mocks.messageFindMany },
  },
}));

vi.mock("../ai.service", () => ({
  classifyIntent: vi.fn(),
  extractStructuredData: vi.fn(),
  runTenantLlmJson: vi.fn(),
  summarizeConversation: mocks.summarizeConversation,
}));

describe("aiNodes AI_SUMMARIZE handler", () => {
  beforeEach(() => {
    mocks.messageFindMany.mockReset();
    mocks.summarizeConversation.mockReset();
  });

  it("queries messages with desc + take so we get the most recent N", async () => {
    mocks.messageFindMany.mockResolvedValue([]); // empty -> short-circuits
    mocks.summarizeConversation.mockResolvedValue({ summary: "", bullets: [] });

    const { aiFlowNodeHandlers } = await import("./aiNodes");
    const handler = aiFlowNodeHandlers.AI_SUMMARIZE;
    await handler.run(
      {
        id: "n_1",
        type: "AI_SUMMARIZE",
        config: { lookback: 25 },
        next: "n_end",
      },
      {
        tenantId: "t_1",
        flowId: "f_1",
        runId: "r_1",
        contactId: "c_1",
        conversationId: "conv_1",
        vars: {},
      },
    );

    expect(mocks.messageFindMany).toHaveBeenCalledTimes(1);
    const arg = mocks.messageFindMany.mock.calls[0][0];
    expect(arg.where).toEqual({ conversationId: "conv_1" });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.take).toBe(25);
  });

  it("hands messages to summarizeConversation in chronological order", async () => {
    // DB returns newest-first because the query is `desc`. The handler
    // must reverse() before passing to the summarizer.
    mocks.messageFindMany.mockResolvedValue([
      { direction: "OUTBOUND", content: "msg-3 (newest)" },
      { direction: "INBOUND", content: "msg-2" },
      { direction: "OUTBOUND", content: "msg-1 (oldest)" },
    ]);
    mocks.summarizeConversation.mockResolvedValue({
      summary: "test",
      bullets: [],
    });

    const { aiFlowNodeHandlers } = await import("./aiNodes");
    const handler = aiFlowNodeHandlers.AI_SUMMARIZE;
    await handler.run(
      {
        id: "n_1",
        type: "AI_SUMMARIZE",
        config: {},
        next: null as unknown as string,
      },
      {
        tenantId: "t_1",
        flowId: "f_1",
        runId: "r_1",
        contactId: "c_1",
        conversationId: "conv_1",
        vars: {},
      },
    );

    expect(mocks.summarizeConversation).toHaveBeenCalledTimes(1);
    const [, payload] = mocks.summarizeConversation.mock.calls[0];
    // After reverse() the array should be oldest-first.
    expect(payload.messages.map((m: { content: string }) => m.content)).toEqual([
      "msg-1 (oldest)",
      "msg-2",
      "msg-3 (newest)",
    ]);
  });
});
