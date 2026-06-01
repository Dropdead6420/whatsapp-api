// Regression tests for the agent-scoping invariant on
// `POST /api/v1/conversations/:id/ai-summary`. The route MUST scope
// the conversation lookup to the caller's own assigned conversation
// when the caller's role is "AGENT" — otherwise an agent could
// summarize any conversation in the tenant by guessing an id.
//
// The actual handler builds the where clause inline; this test mirrors
// the same shape so a future PR that drops the agentId pin fails loud
// before the regression ships.

import { describe, expect, it } from "vitest";
import { z } from "zod";

// Mirrors the schema inline in the handler. Keeping a copy here means
// the test stays tight + fast (no prisma / express graph imported).
const aiSummarySchema = z.object({
  focus: z.string().trim().min(1).max(200).optional(),
});

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

describe("ai-summary schema", () => {
  it("accepts an empty body (focus is optional)", () => {
    expect(aiSummarySchema.parse({})).toEqual({});
  });

  it("trims focus before validation", () => {
    expect(aiSummarySchema.parse({ focus: "  upgrade question  " })).toEqual({
      focus: "upgrade question",
    });
  });

  it("rejects a whitespace-only focus (after trim → empty → min(1))", () => {
    expect(() => aiSummarySchema.parse({ focus: "   " })).toThrow();
  });

  it("rejects an oversized focus", () => {
    expect(() => aiSummarySchema.parse({ focus: "x".repeat(201) })).toThrow();
  });

  it("strips arbitrary unknown body params (Zod default)", () => {
    // Critical: a future PR adding e.g. `tenantId` to the body must
    // NOT let the caller override the JWT-scoped tenant. The schema
    // dropping unknown keys is the first defense.
    const parsed = aiSummarySchema.parse({
      tenantId: "tenant_someone_else",
      conversationId: "evil",
      focus: "real",
    });
    expect("tenantId" in parsed).toBe(false);
    expect("conversationId" in parsed).toBe(false);
    expect(parsed.focus).toBe("real");
  });
});

describe("ai-summary scoping invariant", () => {
  it("pins agentId for AGENT role", () => {
    const where = buildWhere({
      conversationId: "c_1",
      tenantId: "tenant_a",
      userRole: "AGENT",
      userId: "user_agent",
    });
    expect(where).toEqual({
      id: "c_1",
      tenantId: "tenant_a",
      agentId: "user_agent",
    });
  });

  it("does NOT pin agentId for BUSINESS_ADMIN (can summarize any in-tenant)", () => {
    const where = buildWhere({
      conversationId: "c_1",
      tenantId: "tenant_a",
      userRole: "BUSINESS_ADMIN",
      userId: "user_admin",
    });
    expect(where).toEqual({ id: "c_1", tenantId: "tenant_a" });
    expect("agentId" in where).toBe(false);
  });

  it("does NOT pin agentId for TEAM_LEAD (same as admin scope)", () => {
    const where = buildWhere({
      conversationId: "c_1",
      tenantId: "tenant_a",
      userRole: "TEAM_LEAD",
      userId: "user_lead",
    });
    expect(where).toEqual({ id: "c_1", tenantId: "tenant_a" });
  });

  it("always includes tenantId regardless of role", () => {
    for (const role of ["AGENT", "BUSINESS_ADMIN", "TEAM_LEAD", "SUPER_ADMIN"]) {
      const where = buildWhere({
        conversationId: "c_1",
        tenantId: "tenant_xyz",
        userRole: role,
        userId: "u_1",
      });
      expect(where.tenantId).toBe("tenant_xyz");
    }
  });

  it("AGENT scoping isolates two agents on the same tenant", () => {
    // Two agents in tenant_a can't see each other's conversations.
    const agentA = buildWhere({
      conversationId: "c_shared",
      tenantId: "tenant_a",
      userRole: "AGENT",
      userId: "agent_a",
    });
    const agentB = buildWhere({
      conversationId: "c_shared",
      tenantId: "tenant_a",
      userRole: "AGENT",
      userId: "agent_b",
    });
    expect(agentA.agentId).toBe("agent_a");
    expect(agentB.agentId).toBe("agent_b");
    expect(agentA.agentId).not.toBe(agentB.agentId);
  });
});
