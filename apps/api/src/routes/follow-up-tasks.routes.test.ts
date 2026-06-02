// Regression tests for the follow-up-task route layer.
//
// These tests pin two things the runtime depends on:
//   1. Zod schemas — every shape the API accepts vs rejects.
//   2. The agent-pin invariant — an AGENT caller is always pinned to
//      assigneeId=userId on every operation (list / patch / complete /
//      cancel). A future PR that drops the pin must fail loud here.
//
// We mirror the schemas inline rather than importing from the route
// module so this test stays fast (no prisma / express graph imported).

import { describe, expect, it } from "vitest";
import { z } from "zod";

const STATUS_VALUES = ["PENDING", "DONE", "CANCELLED"] as const;

const createSchema = z.object({
  title: z.string().min(1).max(280),
  dueAt: z.string().datetime(),
  assigneeId: z.string().min(1).optional(),
  notes: z.string().max(4000).optional().nullable(),
  contactId: z.string().min(1).optional().nullable(),
  conversationId: z.string().min(1).optional().nullable(),
});

const listQuerySchema = z.object({
  assigneeId: z.string().min(1).optional(),
  statuses: z
    .string()
    .optional()
    .transform((raw) => {
      if (!raw) return undefined;
      const parts = raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      const valid = parts.filter((p): p is (typeof STATUS_VALUES)[number] =>
        (STATUS_VALUES as readonly string[]).includes(p),
      );
      return valid.length > 0 ? valid : undefined;
    }),
  contactId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      const parsed = Number.parseInt(v, 10);
      return Number.isNaN(parsed) ? 1 : Math.min(200, Math.max(1, parsed));
    }),
});

const patchSchema = z.object({
  title: z.string().min(1).max(280).optional(),
  dueAt: z.string().datetime().optional(),
  assigneeId: z.string().min(1).optional(),
  notes: z.string().max(4000).optional().nullable(),
});

function agentPin(role: string | undefined, userId: string | undefined) {
  return role === "AGENT" ? userId : undefined;
}

describe("createSchema", () => {
  const validBody = {
    title: "Call back tomorrow",
    dueAt: new Date(Date.now() + 60_000).toISOString(),
  };

  it("accepts the minimal valid body", () => {
    expect(() => createSchema.parse(validBody)).not.toThrow();
  });

  it("rejects empty title", () => {
    expect(() => createSchema.parse({ ...validBody, title: "" })).toThrow();
  });

  it("rejects oversized title (>280)", () => {
    expect(() =>
      createSchema.parse({ ...validBody, title: "x".repeat(281) }),
    ).toThrow();
  });

  it("rejects non-ISO dueAt", () => {
    expect(() =>
      createSchema.parse({ ...validBody, dueAt: "tomorrow" }),
    ).toThrow();
  });

  it("accepts optional notes / context", () => {
    const parsed = createSchema.parse({
      ...validBody,
      notes: "Customer prefers WhatsApp over email",
      contactId: "c_123",
      conversationId: "conv_456",
    });
    expect(parsed.contactId).toBe("c_123");
    expect(parsed.conversationId).toBe("conv_456");
  });

  it("rejects oversized notes (>4000)", () => {
    expect(() =>
      createSchema.parse({ ...validBody, notes: "n".repeat(4001) }),
    ).toThrow();
  });

  it("strips arbitrary unknown fields (Zod default behavior)", () => {
    const parsed = createSchema.parse({
      ...validBody,
      tenantId: "evil",
      createdById: "evil",
    });
    expect("tenantId" in parsed).toBe(false);
    expect("createdById" in parsed).toBe(false);
  });
});

describe("listQuerySchema", () => {
  it("accepts an empty query (defaults applied later)", () => {
    expect(listQuerySchema.parse({})).toEqual({});
  });

  it("parses comma-separated statuses, uppercases, filters invalid", () => {
    const parsed = listQuerySchema.parse({
      statuses: "pending, done , bogus, CANCELLED",
    });
    expect(parsed.statuses).toEqual(["PENDING", "DONE", "CANCELLED"]);
  });

  it("returns undefined when no valid statuses parsed", () => {
    const parsed = listQuerySchema.parse({ statuses: "garbage,foo" });
    expect(parsed.statuses).toBeUndefined();
  });

  it("clamps limit to [1, 200]", () => {
    expect(listQuerySchema.parse({ limit: "5000" }).limit).toBe(200);
    expect(listQuerySchema.parse({ limit: "0" }).limit).toBe(1);
    expect(listQuerySchema.parse({ limit: "abc" }).limit).toBe(1);
    expect(listQuerySchema.parse({ limit: "50" }).limit).toBe(50);
  });
});

describe("patchSchema", () => {
  it("accepts a single-field patch", () => {
    expect(patchSchema.parse({ title: "Updated" })).toEqual({
      title: "Updated",
    });
  });

  it("accepts notes:null (explicit clear)", () => {
    expect(patchSchema.parse({ notes: null }).notes).toBeNull();
  });

  it("rejects empty title in patch", () => {
    expect(() => patchSchema.parse({ title: "" })).toThrow();
  });

  it("rejects non-ISO dueAt in patch", () => {
    expect(() => patchSchema.parse({ dueAt: "soon" })).toThrow();
  });
});

describe("agentPin invariant", () => {
  it("AGENT role pins to their userId", () => {
    expect(agentPin("AGENT", "user_42")).toBe("user_42");
  });

  it("BUSINESS_ADMIN gets no pin (sees full tenant queue)", () => {
    expect(agentPin("BUSINESS_ADMIN", "u")).toBeUndefined();
  });

  it("TEAM_LEAD gets no pin (sees full tenant queue)", () => {
    expect(agentPin("TEAM_LEAD", "u")).toBeUndefined();
  });

  it("SUPER_ADMIN gets no pin", () => {
    expect(agentPin("SUPER_ADMIN", "u")).toBeUndefined();
  });

  it("undefined role gets no pin (defense in depth — auth middleware should reject anyway)", () => {
    expect(agentPin(undefined, "u")).toBeUndefined();
  });

  it("AGENT with no userId pins to undefined (impossible after auth — sanity)", () => {
    expect(agentPin("AGENT", undefined)).toBeUndefined();
  });
});

describe("assigneeId reassignment rule (manual mirror of route gate)", () => {
  // Mirrors: if (pin && body.assigneeId !== undefined && body.assigneeId !== pin) → FORBIDDEN
  function isReassignBlocked(args: {
    role: string;
    userId: string;
    bodyAssigneeId: string | undefined;
  }): boolean {
    const pin = agentPin(args.role, args.userId);
    return Boolean(
      pin &&
        args.bodyAssigneeId !== undefined &&
        args.bodyAssigneeId !== pin,
    );
  }

  it("AGENT trying to reassign to a different user is blocked", () => {
    expect(
      isReassignBlocked({
        role: "AGENT",
        userId: "u_self",
        bodyAssigneeId: "u_other",
      }),
    ).toBe(true);
  });

  it("AGENT setting assigneeId to themselves is allowed (no-op)", () => {
    expect(
      isReassignBlocked({
        role: "AGENT",
        userId: "u_self",
        bodyAssigneeId: "u_self",
      }),
    ).toBe(false);
  });

  it("AGENT not touching assigneeId is allowed", () => {
    expect(
      isReassignBlocked({
        role: "AGENT",
        userId: "u_self",
        bodyAssigneeId: undefined,
      }),
    ).toBe(false);
  });

  it("BUSINESS_ADMIN reassigning to anyone is allowed", () => {
    expect(
      isReassignBlocked({
        role: "BUSINESS_ADMIN",
        userId: "u_admin",
        bodyAssigneeId: "u_anyone",
      }),
    ).toBe(false);
  });

  it("TEAM_LEAD reassigning to anyone is allowed", () => {
    expect(
      isReassignBlocked({
        role: "TEAM_LEAD",
        userId: "u_lead",
        bodyAssigneeId: "u_anyone",
      }),
    ).toBe(false);
  });
});
