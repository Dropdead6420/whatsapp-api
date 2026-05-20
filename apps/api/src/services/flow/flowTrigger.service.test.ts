import { describe, it, expect, vi, beforeEach } from "vitest";
import { tagsAdded } from "./flowTrigger.service";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  startFlowRun: vi.fn(),
  findFlowForInbound: vi.fn(),
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
  });

  it("uses keyword flow when matched", async () => {
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
  });
});
