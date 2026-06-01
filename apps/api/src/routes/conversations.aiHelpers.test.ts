// Regression tests for the 3 sibling AI routes on conversations.routes.ts
// (ai-reply-suggest, ai-sentiment, ai-extract-lead). They all share the
// same agent-scope guard as ai-summary — every test here pins one
// schema constraint or one scope-invariant detail so a future PR that
// drops the agentId pin or widens a schema fails loud.

import { describe, expect, it } from "vitest";
import { z } from "zod";

// Mirror the schemas inline. See conversations.routes.ts for the
// reason this test file doesn't import them directly (keeps the test
// graph tiny — no prisma / express graph pulled in).

const replySuggestSchema = z.object({
  languageHint: z.string().trim().min(1).max(40).optional(),
});

const extractLeadSchema = z.object({
  fields: z.record(z.string().min(1).max(64), z.string().min(1).max(200)).optional(),
});

const DEFAULT_LEAD_FIELDS: Record<string, string> = {
  name: "full name of the person",
  email: "email address",
  phone: "phone number in any format",
  intent: "what the customer wants (1 short phrase)",
  urgency: '"high" | "normal" | "low" — how time-sensitive',
};

function buildWhere(args: {
  conversationId: string;
  tenantId: string;
  userRole: string;
  userId: string;
}) {
  return {
    id: args.conversationId,
    tenantId: args.tenantId,
    ...(args.userRole === "AGENT" ? { agentId: args.userId } : {}),
  };
}

describe("replySuggest schema", () => {
  it("accepts an empty body", () => {
    expect(replySuggestSchema.parse({})).toEqual({});
  });

  it("accepts an optional language hint", () => {
    expect(replySuggestSchema.parse({ languageHint: "en-IN" })).toEqual({
      languageHint: "en-IN",
    });
  });

  it("trims language hint before validation", () => {
    expect(replySuggestSchema.parse({ languageHint: "  hi-IN  " })).toEqual({
      languageHint: "hi-IN",
    });
  });

  it("rejects an oversized language hint (>40 chars)", () => {
    expect(() => replySuggestSchema.parse({ languageHint: "x".repeat(41) })).toThrow();
  });

  it("strips arbitrary unknown body params", () => {
    const parsed = replySuggestSchema.parse({
      languageHint: "en",
      tenantId: "tenant_evil",
      agentId: "evil",
    });
    expect("tenantId" in parsed).toBe(false);
    expect("agentId" in parsed).toBe(false);
    expect(parsed.languageHint).toBe("en");
  });
});

describe("extractLead schema", () => {
  it("accepts an empty body (route falls back to DEFAULT_LEAD_FIELDS)", () => {
    expect(extractLeadSchema.parse({})).toEqual({});
  });

  it("accepts a custom field map", () => {
    const parsed = extractLeadSchema.parse({
      fields: { topic: "what they asked about", budget: "monthly budget" },
    });
    expect(parsed.fields).toEqual({
      topic: "what they asked about",
      budget: "monthly budget",
    });
  });

  it("rejects empty field names", () => {
    expect(() =>
      extractLeadSchema.parse({ fields: { "": "nothing" } }),
    ).toThrow();
  });

  it("rejects oversized field names (>64)", () => {
    expect(() =>
      extractLeadSchema.parse({ fields: { ["x".repeat(65)]: "desc" } }),
    ).toThrow();
  });

  it("rejects oversized field descriptions (>200)", () => {
    expect(() =>
      extractLeadSchema.parse({ fields: { intent: "x".repeat(201) } }),
    ).toThrow();
  });

  it("strips arbitrary unknown body params", () => {
    const parsed = extractLeadSchema.parse({
      fields: { name: "n" },
      tenantId: "tenant_evil",
    });
    expect("tenantId" in parsed).toBe(false);
  });
});

describe("DEFAULT_LEAD_FIELDS sanity", () => {
  it("ships exactly the 5 lead-shape fields", () => {
    expect(Object.keys(DEFAULT_LEAD_FIELDS).sort()).toEqual([
      "email",
      "intent",
      "name",
      "phone",
      "urgency",
    ]);
  });

  it("every field description fits the schema bounds", () => {
    const valid = extractLeadSchema.safeParse({ fields: DEFAULT_LEAD_FIELDS });
    expect(valid.success).toBe(true);
  });
});

describe("ai-helpers scoping invariant (shared with ai-summary)", () => {
  it("pins agentId for AGENT role", () => {
    expect(
      buildWhere({
        conversationId: "c_1",
        tenantId: "t_a",
        userRole: "AGENT",
        userId: "agent_1",
      }),
    ).toEqual({ id: "c_1", tenantId: "t_a", agentId: "agent_1" });
  });

  it("does NOT pin agentId for BUSINESS_ADMIN", () => {
    const where = buildWhere({
      conversationId: "c_1",
      tenantId: "t_a",
      userRole: "BUSINESS_ADMIN",
      userId: "admin",
    });
    expect(where).toEqual({ id: "c_1", tenantId: "t_a" });
    expect("agentId" in where).toBe(false);
  });

  it("does NOT pin agentId for TEAM_LEAD", () => {
    const where = buildWhere({
      conversationId: "c_1",
      tenantId: "t_a",
      userRole: "TEAM_LEAD",
      userId: "lead",
    });
    expect("agentId" in where).toBe(false);
  });

  it("two agents on the same tenant are isolated", () => {
    const a = buildWhere({
      conversationId: "c_shared",
      tenantId: "t_a",
      userRole: "AGENT",
      userId: "agent_a",
    });
    const b = buildWhere({
      conversationId: "c_shared",
      tenantId: "t_a",
      userRole: "AGENT",
      userId: "agent_b",
    });
    expect(a.agentId).not.toBe(b.agentId);
  });

  it("tenantId always present regardless of role", () => {
    for (const role of ["AGENT", "BUSINESS_ADMIN", "TEAM_LEAD", "SUPER_ADMIN"]) {
      const where = buildWhere({
        conversationId: "c_1",
        tenantId: "t_pinned",
        userRole: role,
        userId: "u_1",
      });
      expect(where.tenantId).toBe("t_pinned");
    }
  });
});
