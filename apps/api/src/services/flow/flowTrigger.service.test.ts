import { describe, it, expect, vi, beforeEach } from "vitest";
import { tagsAdded } from "./flowTrigger.service";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  startFlowRun: vi.fn(),
  findFlowForInbound: vi.fn(),
  maybeRunDefaultAgentReply: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    chatbotFlow: { findMany: mocks.findMany },
  },
}));

vi.mock("./engine", () => ({
  startFlowRun: mocks.startFlowRun,
  findFlowForInbound: mocks.findFlowForInbound,
}));

// T-052 slice 4: the AI-agent inbound fallback is exercised by its own
// test file; here we stub it to default-skip so it doesn't pollute the
// existing flow-trigger assertions.
vi.mock("../aiAgentInbound.service", () => ({
  maybeRunDefaultAgentReply: mocks.maybeRunDefaultAgentReply,
}));

describe("tagsAdded", () => {
  it("returns only newly added tags", () => {
    expect(tagsAdded(["a"], ["a", "b", "c"])).toEqual(["b", "c"]);
    expect(tagsAdded([], ["vip"])).toEqual(["vip"]);
    expect(tagsAdded(["vip"], ["vip"])).toEqual([]);
  });
});

describe("dispatchFlowTriggers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.startFlowRun.mockResolvedValue("run-1");
  });

  it("starts a lead_created flow", async () => {
    mocks.findMany.mockResolvedValue([{ id: "flow-1", triggerKeywords: [] }]);
    const { dispatchFlowTriggers } = await import("./flowTrigger.service");

    await dispatchFlowTriggers({
      tenantId: "t1",
      trigger: "lead_created",
      contactId: "c1",
    });

    expect(mocks.startFlowRun).toHaveBeenCalledWith(
      expect.objectContaining({ flowId: "flow-1", tenantId: "t1", contactId: "c1" }),
    );
  });

  it("filters tag_added flows by triggerKeywords", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "any-tag", triggerKeywords: [] },
      { id: "vip-only", triggerKeywords: ["vip"] },
    ]);
    const { dispatchFlowTriggers } = await import("./flowTrigger.service");

    await dispatchFlowTriggers({
      tenantId: "t1",
      trigger: "tag_added",
      contactId: "c1",
      tag: "vip",
    });

    expect(mocks.startFlowRun).toHaveBeenCalledTimes(2);
  });

  it("skips tag_added flow when tag not in keyword list", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "vip-only", triggerKeywords: ["vip"] },
    ]);
    const { dispatchFlowTriggers } = await import("./flowTrigger.service");

    await dispatchFlowTriggers({
      tenantId: "t1",
      trigger: "tag_added",
      contactId: "c1",
      tag: "other",
    });

    expect(mocks.startFlowRun).not.toHaveBeenCalled();
  });
});

describe("dispatchInboundMessageFlows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFlowForInbound.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([{ id: "mr-1", triggerKeywords: [] }]);
    mocks.startFlowRun.mockResolvedValue("run-1");
    mocks.maybeRunDefaultAgentReply.mockResolvedValue({
      fired: false,
      reason: "skipped_autoreply_off",
    });
  });

  it("uses keyword flow when matched (skips event triggers AND ai fallback)", async () => {
    mocks.findFlowForInbound.mockResolvedValue("kw-flow");
    const { dispatchInboundMessageFlows } = await import("./flowTrigger.service");

    await dispatchInboundMessageFlows({
      tenantId: "t1",
      contactId: "c1",
      conversationId: "conv-1",
      text: "price",
    });

    expect(mocks.startFlowRun).toHaveBeenCalledWith(
      expect.objectContaining({ flowId: "kw-flow" }),
    );
    expect(mocks.findMany).not.toHaveBeenCalled();
    // Keyword match short-circuits — the AI fallback must NOT run.
    expect(mocks.maybeRunDefaultAgentReply).not.toHaveBeenCalled();
  });

  it("skips AI fallback when message_received flow fires", async () => {
    mocks.findFlowForInbound.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([{ id: "mr-1", triggerKeywords: [] }]);
    const { dispatchInboundMessageFlows } = await import("./flowTrigger.service");

    await dispatchInboundMessageFlows({
      tenantId: "t1",
      contactId: "c1",
      conversationId: "conv-1",
      text: "hello",
    });

    expect(mocks.startFlowRun).toHaveBeenCalledTimes(1);
    // A flow fired — AI fallback must NOT run.
    expect(mocks.maybeRunDefaultAgentReply).not.toHaveBeenCalled();
  });

  it("falls through to AI fallback when no keyword AND no event-triggered flow matches", async () => {
    mocks.findFlowForInbound.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([]); // no message_received flow
    const { dispatchInboundMessageFlows } = await import("./flowTrigger.service");

    await dispatchInboundMessageFlows({
      tenantId: "t1",
      contactId: "c1",
      conversationId: "conv-1",
      text: "anything",
    });

    expect(mocks.maybeRunDefaultAgentReply).toHaveBeenCalledTimes(1);
    expect(mocks.maybeRunDefaultAgentReply.mock.calls[0][0]).toMatchObject({
      tenantId: "t1",
      contactId: "c1",
      conversationId: "conv-1",
      text: "anything",
    });
  });
});
