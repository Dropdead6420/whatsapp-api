import { beforeEach, describe, expect, it, vi } from "vitest";

// T-051 slice 1 — Knowledge Base CRUD + lifecycle. Mocked-Prisma unit
// tests; the goal is to lock the tenant-scoping rules, the validation
// rules, and the lifecycle transition semantics (DRAFT → PUBLISHED →
// ARCHIVED, idempotent transitions, archive-before-republish gate).

const mocks = vi.hoisted(() => ({
  kbCreate: vi.fn(),
  kbFindFirst: vi.fn(),
  kbUpdate: vi.fn(),
  kbDelete: vi.fn(),
  kbFindMany: vi.fn(),
  kbCount: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    knowledgeBaseEntry: {
      create: mocks.kbCreate,
      findFirst: mocks.kbFindFirst,
      update: mocks.kbUpdate,
      delete: mocks.kbDelete,
      findMany: mocks.kbFindMany,
      count: mocks.kbCount,
    },
    $transaction: mocks.transaction,
  },
  KnowledgeBaseStatus: {
    DRAFT: "DRAFT",
    PUBLISHED: "PUBLISHED",
    ARCHIVED: "ARCHIVED",
  },
  KnowledgeBaseCategory: {
    FAQ: "FAQ",
    SERVICE: "SERVICE",
    PRODUCT: "PRODUCT",
    POLICY: "POLICY",
    HOURS: "HOURS",
    LOCATION: "LOCATION",
    OTHER: "OTHER",
  },
}));

function fixtureEntry(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date("2026-05-21T00:00:00Z");
  return {
    id: "kb_1",
    tenantId: "t_1",
    title: "How do I cancel my appointment?",
    content: "Reply CANCEL to your booking confirmation message.",
    summary: null,
    category: "FAQ",
    tags: ["cancellation"],
    source: "manual",
    sourceUrl: null,
    status: "DRAFT",
    publishedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("knowledgeBase.service", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => {
      if (typeof m === "function" && "mockReset" in m) m.mockReset();
    });
  });

  // -- listEntries -----------------------------------------------------------

  it("listEntries: every query scoped by tenantId", async () => {
    mocks.transaction.mockResolvedValue([0, []]);
    const { listEntries } = await import("./knowledgeBase.service");
    await listEntries("t_1", { status: "PUBLISHED", category: "FAQ" });
    // $transaction is called with [count, findMany] calls — assert each
    // got the tenant filter.
    const callArgs = mocks.transaction.mock.calls[0][0];
    expect(Array.isArray(callArgs)).toBe(true);
    // The mock returns immediately so we inspect via the count + findMany
    // call args instead.
    expect(mocks.kbCount).toHaveBeenCalledWith({
      where: expect.objectContaining({ tenantId: "t_1", status: "PUBLISHED" }),
    });
    expect(mocks.kbFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t_1",
          status: "PUBLISHED",
          category: "FAQ",
        }),
        orderBy: [{ updatedAt: "desc" }],
      }),
    );
  });

  it('listEntries: "ALL" status filter omits the status clause', async () => {
    mocks.transaction.mockResolvedValue([0, []]);
    const { listEntries } = await import("./knowledgeBase.service");
    await listEntries("t_1", { status: "ALL" });
    const where = mocks.kbCount.mock.calls[0][0].where;
    expect(where).toEqual({ tenantId: "t_1" });
    expect(where).not.toHaveProperty("status");
  });

  it("listEntries: applies case-insensitive search across title + content", async () => {
    mocks.transaction.mockResolvedValue([0, []]);
    const { listEntries } = await import("./knowledgeBase.service");
    await listEntries("t_1", { search: "Cancel" });
    const where = mocks.kbCount.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { title: { contains: "Cancel", mode: "insensitive" } },
      { content: { contains: "Cancel", mode: "insensitive" } },
    ]);
  });

  it("listEntries: clamps page + limit to safe ranges", async () => {
    mocks.transaction.mockResolvedValue([0, []]);
    const { listEntries } = await import("./knowledgeBase.service");
    await listEntries("t_1", { page: 0, limit: 5000 });
    const args = mocks.kbFindMany.mock.calls[0][0];
    expect(args.skip).toBe(0); // page 0 → page 1 → skip 0
    expect(args.take).toBe(100); // limit clamped to 100
  });

  // -- createEntry validation -----------------------------------------------

  it("createEntry: rejects missing title", async () => {
    const { createEntry } = await import("./knowledgeBase.service");
    await expect(
      createEntry("t_1", { title: "", content: "hello" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: /title/,
    });
    expect(mocks.kbCreate).not.toHaveBeenCalled();
  });

  it("createEntry: rejects oversize content", async () => {
    const { createEntry } = await import("./knowledgeBase.service");
    await expect(
      createEntry("t_1", {
        title: "ok",
        content: "x".repeat(50_001),
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: /content/ });
  });

  it("createEntry: rejects unknown category", async () => {
    const { createEntry } = await import("./knowledgeBase.service");
    await expect(
      createEntry("t_1", {
        title: "ok",
        content: "x",
        category: "PIZZA",
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: /category/ });
  });

  it("createEntry: rejects malformed sourceUrl", async () => {
    const { createEntry } = await import("./knowledgeBase.service");
    await expect(
      createEntry("t_1", {
        title: "ok",
        content: "x",
        sourceUrl: "not-a-url",
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: /sourceUrl/ });
  });

  it("createEntry: normalises tags (lowercase, dedupe, cap at 20)", async () => {
    mocks.kbCreate.mockImplementation(async ({ data }) =>
      fixtureEntry({ ...data, id: "kb_new" }),
    );
    const { createEntry } = await import("./knowledgeBase.service");
    const dupTags = ["FAQ", "faq", "Hours", " hours ", "  "];
    const result = await createEntry("t_1", {
      title: "t",
      content: "c",
      tags: dupTags,
    });
    expect(result.tags).toEqual(["faq", "hours"]);
  });

  it("createEntry: publish:true creates row in PUBLISHED status with publishedAt", async () => {
    mocks.kbCreate.mockImplementation(async ({ data }) =>
      fixtureEntry({ ...data, id: "kb_new" }),
    );
    const { createEntry } = await import("./knowledgeBase.service");
    const result = await createEntry("t_1", {
      title: "t",
      content: "c",
      publish: true,
    });
    expect(result.status).toBe("PUBLISHED");
    expect(result.publishedAt).not.toBeNull();
  });

  it("createEntry: default (no publish) creates DRAFT with null publishedAt", async () => {
    mocks.kbCreate.mockImplementation(async ({ data }) =>
      fixtureEntry({ ...data, id: "kb_new" }),
    );
    const { createEntry } = await import("./knowledgeBase.service");
    const result = await createEntry("t_1", { title: "t", content: "c" });
    expect(result.status).toBe("DRAFT");
    expect(result.publishedAt).toBeNull();
  });

  // -- getEntry --------------------------------------------------------------

  it("getEntry: 404 on cross-tenant access", async () => {
    mocks.kbFindFirst.mockResolvedValue(null); // simulates wrong tenant
    const { getEntry } = await import("./knowledgeBase.service");
    await expect(getEntry("t_1", "kb_other_tenant")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mocks.kbFindFirst).toHaveBeenCalledWith({
      where: { id: "kb_other_tenant", tenantId: "t_1" },
    });
  });

  // -- updateEntry -----------------------------------------------------------

  it("updateEntry: empty body returns current state without an update call", async () => {
    mocks.kbFindFirst.mockResolvedValue(fixtureEntry());
    const { updateEntry } = await import("./knowledgeBase.service");
    const result = await updateEntry("t_1", "kb_1", {});
    expect(result.id).toBe("kb_1");
    expect(mocks.kbUpdate).not.toHaveBeenCalled();
  });

  it("updateEntry: tenant scoping checked BEFORE the update", async () => {
    mocks.kbFindFirst.mockResolvedValue(null); // wrong tenant
    const { updateEntry } = await import("./knowledgeBase.service");
    await expect(
      updateEntry("t_1", "kb_other", { title: "new" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.kbUpdate).not.toHaveBeenCalled();
  });

  // -- lifecycle -------------------------------------------------------------

  it("publishEntry: refuses ARCHIVED → PUBLISHED (must restore first)", async () => {
    mocks.kbFindFirst.mockResolvedValue(
      fixtureEntry({ status: "ARCHIVED", archivedAt: new Date() }),
    );
    const { publishEntry } = await import("./knowledgeBase.service");
    await expect(publishEntry("t_1", "kb_1")).rejects.toMatchObject({
      statusCode: 400,
      message: /archived/i,
    });
    expect(mocks.kbUpdate).not.toHaveBeenCalled();
  });

  it("publishEntry: idempotent — already PUBLISHED returns row without an update", async () => {
    mocks.kbFindFirst.mockResolvedValue(
      fixtureEntry({ status: "PUBLISHED", publishedAt: new Date() }),
    );
    const { publishEntry } = await import("./knowledgeBase.service");
    const result = await publishEntry("t_1", "kb_1");
    expect(result.status).toBe("PUBLISHED");
    expect(mocks.kbUpdate).not.toHaveBeenCalled();
  });

  it("publishEntry: DRAFT → PUBLISHED stamps publishedAt + clears archivedAt", async () => {
    mocks.kbFindFirst.mockResolvedValue(fixtureEntry({ status: "DRAFT" }));
    mocks.kbUpdate.mockImplementation(async ({ data }) =>
      fixtureEntry({ ...data }),
    );
    const { publishEntry } = await import("./knowledgeBase.service");
    const result = await publishEntry("t_1", "kb_1");
    expect(result.status).toBe("PUBLISHED");
    const updateCall = mocks.kbUpdate.mock.calls[0][0];
    expect(updateCall.data.publishedAt).toBeInstanceOf(Date);
    expect(updateCall.data.archivedAt).toBeNull();
  });

  it("archiveEntry: idempotent on already-archived", async () => {
    mocks.kbFindFirst.mockResolvedValue(fixtureEntry({ status: "ARCHIVED" }));
    const { archiveEntry } = await import("./knowledgeBase.service");
    await archiveEntry("t_1", "kb_1");
    expect(mocks.kbUpdate).not.toHaveBeenCalled();
  });

  it("archiveEntry: PUBLISHED → ARCHIVED stamps archivedAt", async () => {
    mocks.kbFindFirst.mockResolvedValue(fixtureEntry({ status: "PUBLISHED" }));
    mocks.kbUpdate.mockImplementation(async ({ data }) =>
      fixtureEntry({ ...data }),
    );
    const { archiveEntry } = await import("./knowledgeBase.service");
    const result = await archiveEntry("t_1", "kb_1");
    expect(result.status).toBe("ARCHIVED");
    const updateCall = mocks.kbUpdate.mock.calls[0][0];
    expect(updateCall.data.archivedAt).toBeInstanceOf(Date);
  });

  it("restoreEntryToDraft: clears publishedAt + archivedAt + sets DRAFT", async () => {
    mocks.kbFindFirst.mockResolvedValue(fixtureEntry({ status: "ARCHIVED" }));
    mocks.kbUpdate.mockImplementation(async ({ data }) =>
      fixtureEntry({ ...data }),
    );
    const { restoreEntryToDraft } = await import("./knowledgeBase.service");
    const result = await restoreEntryToDraft("t_1", "kb_1");
    expect(result.status).toBe("DRAFT");
    const updateCall = mocks.kbUpdate.mock.calls[0][0];
    expect(updateCall.data.publishedAt).toBeNull();
    expect(updateCall.data.archivedAt).toBeNull();
  });

  // -- deleteEntry -----------------------------------------------------------

  it("deleteEntry: refuses cross-tenant delete (404)", async () => {
    mocks.kbFindFirst.mockResolvedValue(null);
    const { deleteEntry } = await import("./knowledgeBase.service");
    await expect(deleteEntry("t_1", "kb_other")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mocks.kbDelete).not.toHaveBeenCalled();
  });

  it("deleteEntry: in-tenant delete proceeds", async () => {
    mocks.kbFindFirst.mockResolvedValue(fixtureEntry());
    mocks.kbDelete.mockResolvedValue({});
    const { deleteEntry } = await import("./knowledgeBase.service");
    await deleteEntry("t_1", "kb_1");
    expect(mocks.kbDelete).toHaveBeenCalledWith({ where: { id: "kb_1" } });
  });
});
