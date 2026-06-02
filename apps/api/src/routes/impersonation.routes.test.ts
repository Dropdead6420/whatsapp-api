// Tests for the impersonation route layer.
//
// These mirror the route's Zod schemas inline (no Express graph) and
// pin one invariant the route relies on: /exit is recognized only when
// req.actorUserId is set, regardless of role.

import { describe, expect, it } from "vitest";
import { z } from "zod";

const startSchema = z.object({
  targetTenantId: z.string().min(1),
  targetUserId: z.string().min(1).optional(),
  reason: z.string().trim().min(1).max(280).optional(),
});

function isImpersonating(req: {
  impersonating?: boolean;
  actorUserId?: string;
}) {
  return Boolean(req.impersonating && req.actorUserId);
}

describe("startSchema", () => {
  it("accepts the minimal valid body", () => {
    expect(() =>
      startSchema.parse({ targetTenantId: "t_42" }),
    ).not.toThrow();
  });

  it("accepts an explicit target user + reason", () => {
    const parsed = startSchema.parse({
      targetTenantId: "t_42",
      targetUserId: "user_99",
      reason: "Customer support ticket #12345",
    });
    expect(parsed).toEqual({
      targetTenantId: "t_42",
      targetUserId: "user_99",
      reason: "Customer support ticket #12345",
    });
  });

  it("rejects empty targetTenantId", () => {
    expect(() => startSchema.parse({ targetTenantId: "" })).toThrow();
  });

  it("trims and rejects whitespace-only reason", () => {
    expect(() =>
      startSchema.parse({ targetTenantId: "t_42", reason: "   " }),
    ).toThrow();
  });

  it("trims a valid reason", () => {
    const parsed = startSchema.parse({
      targetTenantId: "t_42",
      reason: "  legit reason  ",
    });
    expect(parsed.reason).toBe("legit reason");
  });

  it("rejects oversized reason (>280)", () => {
    expect(() =>
      startSchema.parse({ targetTenantId: "t_42", reason: "x".repeat(281) }),
    ).toThrow();
  });

  it("strips arbitrary unknown fields", () => {
    const parsed = startSchema.parse({
      targetTenantId: "t_42",
      // Trying to bypass — these can't override the JWT-derived actor.
      actorUserId: "evil",
      actorRole: "BUSINESS_ADMIN",
    });
    expect("actorUserId" in parsed).toBe(false);
    expect("actorRole" in parsed).toBe(false);
  });
});

describe("/exit recognition", () => {
  it("requires both impersonating=true AND actorUserId set", () => {
    expect(isImpersonating({ impersonating: true, actorUserId: "a_1" })).toBe(
      true,
    );
  });

  it("returns false when actorUserId is missing (defense in depth)", () => {
    // impersonating=true without actorUserId would be an invalid token
    // shape — this isn't reachable in practice but the route checks both.
    expect(isImpersonating({ impersonating: true })).toBe(false);
  });

  it("returns false when impersonating flag is missing", () => {
    expect(isImpersonating({ actorUserId: "a_1" })).toBe(false);
  });

  it("returns false on a fully empty request shape", () => {
    expect(isImpersonating({})).toBe(false);
  });

  it("returns false when both flags say no", () => {
    expect(
      isImpersonating({ impersonating: false, actorUserId: undefined }),
    ).toBe(false);
  });
});
