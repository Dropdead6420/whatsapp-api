import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  aiAgentCount: vi.fn(),
  aiAgentFindMany: vi.fn(),
  aiAgentFindFirst: vi.fn(),
  aiAgentCreate: vi.fn(),
  aiAgentUpdate: vi.fn(),
  aiAgentDelete: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    aiAgent: {
      count: mocks.aiAgentCount,
      findMany: mocks.aiAgentFindMany,
      findFirst: mocks.aiAgentFindFirst,
      create: mocks.aiAgentCreate,
      update: mocks.aiAgentUpdate,
      delete: mocks.aiAgentDelete,
    },
    $transaction: mocks.$transaction,
  },
}));

import {
  archiveAgent,
  createAgent,
  deleteAgent,
  disableAgent,
  getAgent,
  listAgents,
  publishAgent,
  updateAgent,
  __test__,
} from "./aiAgent.service";

const now = new Date("2026-05-23T12:00:00.000Z");

function dbAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent_1",
    tenantId: "tenant_1",
    name: "Sales Bot",
    description: "First-touch qualifier",
    persona: "You are a friendly sales assistant.",
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxTokens: 800,
    knowledgeScope: { categories: [], tags: [], topK: 5 },
    tools: [],
    fallbackBehavior: "ESCALATE_TO_HUMAN",
    fallbackTemplateId: null,
    status: "DRAFT",
    publishedAt: null,
    disabledAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  // Default $transaction passthrough — vitest doesn't auto-await arrays.
  mocks.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
});

describe("aiAgent.service", () => {
  it("rejects unsupported provider on create", async () => {
    await expect(
      createAgent("tenant_1", {
        name: "X",
        persona: "P",
        provider: "mythical",
      } as never),
    ).rejects.toThrow(/Unsupported provider/);
  });

  it("rejects a model that isn't on the provider's allowlist", async () => {
    await expect(
      createAgent("tenant_1", {
        name: "X",
        persona: "P",
        provider: "openai",
        model: "gpt-99-turbo",
      } as never),
    ).rejects.toThrow(/not allowed for provider/);
  });

  it("rejects SEND_TEMPLATE fallback without a template id", async () => {
    await expect(
      createAgent("tenant_1", {
        name: "X",
        persona: "P",
        fallbackBehavior: "SEND_TEMPLATE",
      } as never),
    ).rejects.toThrow(/fallbackTemplateId is required/);
  });

  it("normalizes knowledgeScope topK, lowercases tags, dedupes", () => {
    const out = __test__.normalizeKnowledgeScope({
      categories: ["faq", "FAQ", "SERVICE"],
      tags: ["VIP", "vip", "pricing", "  "],
      topK: 999,
    });
    expect(out.topK).toBe(20); // capped to MAX_KB_TOP_K
    expect(out.tags).toEqual(["vip", "pricing"]);
    // categories aren't deduped at the normalize layer — that's intentional;
    // they get matched case-insensitively at retrieval. We just upper-case.
    expect(out.categories).toEqual(["FAQ", "FAQ", "SERVICE"]);
  });

  it("validates tools against the allowlist", () => {
    expect(__test__.validateTools(["create_lead", "add_tag"])).toEqual([
      "CREATE_LEAD",
      "ADD_TAG",
    ]);
    expect(() => __test__.validateTools(["DROP_DATABASE"])).toThrow(
      /Unsupported tool/,
    );
  });

  it("createAgent persists a DRAFT row with normalized fields", async () => {
    mocks.aiAgentCreate.mockResolvedValue(dbAgent({ tools: ["CREATE_LEAD"] }));
    const out = await createAgent("tenant_1", {
      name: "Sales Bot",
      persona: "Be helpful",
      tools: ["create_lead"],
    } as never);
    expect(mocks.aiAgentCreate).toHaveBeenCalledTimes(1);
    const args = mocks.aiAgentCreate.mock.calls[0][0];
    expect(args.data.tenantId).toBe("tenant_1");
    expect(args.data.status).toBe("DRAFT");
    expect(args.data.tools).toEqual(["CREATE_LEAD"]);
    expect(out.status).toBe("DRAFT");
  });

  it("listAgents filters by status, paginates", async () => {
    mocks.$transaction.mockResolvedValue([3, [dbAgent(), dbAgent({ id: "agent_2" })]]);
    const out = await listAgents("tenant_1", {
      status: "ACTIVE",
      page: 2,
      limit: 10,
    });
    expect(out.pagination).toEqual({ page: 2, limit: 10, total: 3 });
    expect(out.agents).toHaveLength(2);
    // Verify the where clause carries tenant + status
    const findArgs = mocks.aiAgentFindMany.mock.calls[0][0];
    expect(findArgs.where).toMatchObject({ tenantId: "tenant_1", status: "ACTIVE" });
    expect(findArgs.skip).toBe(10);
    expect(findArgs.take).toBe(10);
  });

  it("getAgent 404s when the id belongs to another tenant", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue(null);
    await expect(getAgent("tenant_1", "agent_2")).rejects.toThrow(
      /AI agent not found/,
    );
    // findFirst, not findUnique — we need the tenantId in the where clause.
    const where = mocks.aiAgentFindFirst.mock.calls[0][0].where;
    expect(where).toEqual({ id: "agent_2", tenantId: "tenant_1" });
  });

  it("updateAgent merges provider+model and re-validates as a pair", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue(
      dbAgent({ provider: "openai", model: "gpt-4o-mini" }),
    );
    // Patch only the provider; service must fold in the existing model and
    // catch that "claude-*" isn't valid for openai.
    await expect(
      updateAgent("tenant_1", "agent_1", { provider: "anthropic" } as never),
    ).rejects.toThrow(/not allowed for provider "anthropic"/);
  });

  it("publishAgent is idempotent on ACTIVE", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue(
      dbAgent({ status: "ACTIVE", publishedAt: now }),
    );
    const out = await publishAgent("tenant_1", "agent_1");
    expect(mocks.aiAgentUpdate).not.toHaveBeenCalled();
    expect(out.status).toBe("ACTIVE");
  });

  it("publishAgent transitions DRAFT → ACTIVE and stamps publishedAt", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue(dbAgent({ status: "DRAFT" }));
    mocks.aiAgentUpdate.mockResolvedValue(
      dbAgent({ status: "ACTIVE", publishedAt: now }),
    );
    const out = await publishAgent("tenant_1", "agent_1");
    expect(mocks.aiAgentUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mocks.aiAgentUpdate.mock.calls[0][0];
    expect(updateArgs.data.status).toBe("ACTIVE");
    expect(updateArgs.data.publishedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.disabledAt).toBe(null);
    expect(out.status).toBe("ACTIVE");
  });

  it("publishAgent refuses to wake an ARCHIVED agent", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue(
      dbAgent({ status: "ARCHIVED", archivedAt: now }),
    );
    await expect(publishAgent("tenant_1", "agent_1")).rejects.toThrow(
      /Cannot publish an archived/,
    );
  });

  it("disableAgent transitions ACTIVE → DISABLED", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue(
      dbAgent({ status: "ACTIVE", publishedAt: now }),
    );
    mocks.aiAgentUpdate.mockResolvedValue(
      dbAgent({ status: "DISABLED", disabledAt: now }),
    );
    const out = await disableAgent("tenant_1", "agent_1");
    expect(out.status).toBe("DISABLED");
    expect(mocks.aiAgentUpdate.mock.calls[0][0].data.status).toBe("DISABLED");
  });

  it("archiveAgent is idempotent", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue(
      dbAgent({ status: "ARCHIVED", archivedAt: now }),
    );
    await archiveAgent("tenant_1", "agent_1");
    expect(mocks.aiAgentUpdate).not.toHaveBeenCalled();
  });

  it("deleteAgent only deletes after a tenant-scoped lookup", async () => {
    mocks.aiAgentFindFirst.mockResolvedValue(dbAgent());
    mocks.aiAgentDelete.mockResolvedValue(dbAgent());
    await deleteAgent("tenant_1", "agent_1");
    // findFirst must be called (tenant-scoping check) and must run before
    // delete. vitest doesn't ship `toHaveBeenCalledBefore`, so we compare
    // mock invocation order numbers.
    expect(mocks.aiAgentFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.aiAgentDelete).toHaveBeenCalledTimes(1);
    const findOrder = mocks.aiAgentFindFirst.mock.invocationCallOrder[0];
    const deleteOrder = mocks.aiAgentDelete.mock.invocationCallOrder[0];
    expect(findOrder).toBeLessThan(deleteOrder);
    expect(mocks.aiAgentDelete.mock.calls[0][0]).toEqual({
      where: { id: "agent_1" },
    });
  });
});
