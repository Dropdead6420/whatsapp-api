import { describe, expect, it } from "vitest";
import {
  DANGEROUS_ACTION_PATTERNS,
  assertCanStartImpersonation,
  assertNotDangerousAction,
  canImpersonateTargetRole,
  canStartImpersonation,
  isDangerousAction,
} from "./impersonation.service";

describe("canStartImpersonation", () => {
  it("only SUPER_ADMIN can start", () => {
    expect(canStartImpersonation("SUPER_ADMIN")).toBe(true);
    for (const role of [
      "WHITE_LABEL_ADMIN",
      "BUSINESS_ADMIN",
      "TEAM_LEAD",
      "AGENT",
    ] as const) {
      expect(canStartImpersonation(role)).toBe(false);
    }
  });

  it("undefined role rejects", () => {
    expect(canStartImpersonation(undefined)).toBe(false);
  });
});

describe("canImpersonateTargetRole", () => {
  it("rejects SUPER_ADMIN as a target (no privilege loop)", () => {
    expect(canImpersonateTargetRole("SUPER_ADMIN")).toBe(false);
  });

  it("accepts any non-SUPER_ADMIN target", () => {
    for (const role of [
      "WHITE_LABEL_ADMIN",
      "BUSINESS_ADMIN",
      "TEAM_LEAD",
      "AGENT",
    ] as const) {
      expect(canImpersonateTargetRole(role)).toBe(true);
    }
  });
});

describe("isDangerousAction", () => {
  it("matches every documented pattern", () => {
    // Tenants delete
    expect(isDangerousAction("DELETE", "/api/v1/tenants/t_42")).toBe(true);
    // Contacts delete
    expect(isDangerousAction("DELETE", "/api/v1/contacts/c_42")).toBe(true);
    // Wallet writes (recharge, etc.)
    expect(isDangerousAction("POST", "/api/v1/wallets/recharge")).toBe(true);
    expect(isDangerousAction("POST", "/api/v1/wallet-risk/c_42")).toBe(true);
    // Billing changes
    expect(isDangerousAction("POST", "/api/v1/billing/checkout")).toBe(true);
    expect(isDangerousAction("PATCH", "/api/v1/billing/subscription")).toBe(true);
    // Cannot stack impersonations
    expect(isDangerousAction("POST", "/api/v1/admin/impersonate/start")).toBe(
      true,
    );
  });

  it("does NOT block /impersonate/exit — operator must always be able to leave a session", () => {
    expect(isDangerousAction("POST", "/api/v1/admin/impersonate/exit")).toBe(
      false,
    );
  });

  it("case-insensitive on the method", () => {
    expect(isDangerousAction("delete", "/api/v1/tenants/x")).toBe(true);
  });

  it("does NOT match safe reads", () => {
    expect(isDangerousAction("GET", "/api/v1/tenants")).toBe(false);
    expect(isDangerousAction("GET", "/api/v1/wallets")).toBe(false);
    expect(isDangerousAction("GET", "/api/v1/billing")).toBe(false);
  });

  it("does NOT match unrelated routes", () => {
    expect(isDangerousAction("POST", "/api/v1/conversations/abc/reply")).toBe(
      false,
    );
    expect(isDangerousAction("POST", "/api/v1/follow-up-tasks")).toBe(false);
  });

  it("does NOT cross-match a similar-looking path (defense-in-depth)", () => {
    // A made-up path that *contains* "tenants" but isn't a delete.
    expect(isDangerousAction("DELETE", "/api/v1/tenant-impersonations/x")).toBe(
      false,
    );
  });
});

describe("assertNotDangerousAction", () => {
  it("is a no-op when not impersonating", () => {
    expect(() =>
      assertNotDangerousAction({
        impersonating: false,
        method: "DELETE",
        path: "/api/v1/tenants/t_1",
      }),
    ).not.toThrow();
  });

  it("is a no-op for safe routes even when impersonating", () => {
    expect(() =>
      assertNotDangerousAction({
        impersonating: true,
        method: "GET",
        path: "/api/v1/conversations",
      }),
    ).not.toThrow();
  });

  it("blocks dangerous routes when impersonating", () => {
    expect(() =>
      assertNotDangerousAction({
        impersonating: true,
        method: "DELETE",
        path: "/api/v1/tenants/t_42",
      }),
    ).toThrow(/impersonation/i);
  });

  it("treats undefined impersonating as not-impersonating (defense in depth)", () => {
    expect(() =>
      assertNotDangerousAction({
        impersonating: undefined,
        method: "DELETE",
        path: "/api/v1/tenants/t_42",
      }),
    ).not.toThrow();
  });
});

describe("assertCanStartImpersonation", () => {
  const validArgs = {
    actorRole: "SUPER_ADMIN" as const,
    actorUserId: "admin_1",
    targetUserId: "user_42",
    targetRole: "BUSINESS_ADMIN" as const,
  };

  it("passes for the well-formed SUPER_ADMIN case", () => {
    expect(() => assertCanStartImpersonation(validArgs)).not.toThrow();
  });

  it("rejects non-SUPER_ADMIN actors", () => {
    expect(() =>
      assertCanStartImpersonation({ ...validArgs, actorRole: "BUSINESS_ADMIN" }),
    ).toThrow(/SUPER_ADMIN/);
  });

  it("rejects missing actor", () => {
    expect(() =>
      assertCanStartImpersonation({ ...validArgs, actorUserId: undefined }),
    ).toThrow(/actor/i);
  });

  it("rejects self-impersonation", () => {
    expect(() =>
      assertCanStartImpersonation({
        ...validArgs,
        targetUserId: validArgs.actorUserId,
      }),
    ).toThrow(/yourself/i);
  });

  it("rejects targeting another SUPER_ADMIN", () => {
    expect(() =>
      assertCanStartImpersonation({
        ...validArgs,
        targetUserId: "other_admin",
        targetRole: "SUPER_ADMIN",
      }),
    ).toThrow(/SUPER_ADMIN/);
  });
});

describe("DANGEROUS_ACTION_PATTERNS sanity", () => {
  it("starts with HTTP-method + space + path", () => {
    for (const pattern of DANGEROUS_ACTION_PATTERNS) {
      expect(pattern).toMatch(/^(GET|POST|PATCH|PUT|DELETE) \/api\//);
    }
  });

  it("has at least one entry per dangerous category", () => {
    expect(DANGEROUS_ACTION_PATTERNS.some((p) => p.startsWith("DELETE"))).toBe(
      true,
    );
    expect(
      DANGEROUS_ACTION_PATTERNS.some((p) => p.includes("/wallets")),
    ).toBe(true);
    expect(
      DANGEROUS_ACTION_PATTERNS.some((p) => p.includes("/billing")),
    ).toBe(true);
    expect(
      DANGEROUS_ACTION_PATTERNS.some((p) => p.includes("/impersonate")),
    ).toBe(true);
  });
});
