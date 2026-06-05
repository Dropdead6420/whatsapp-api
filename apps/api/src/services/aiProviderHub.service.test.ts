import { describe, expect, it } from "vitest";
import {
  AiProviderKey,
  AiProviderKind,
  AiProviderStatus,
  SecretScope,
} from "@nexaflow/db";
import { UserRole, ApiError } from "@nexaflow/shared";
import {
  deriveProviderContext,
  orderProviderChain,
  toSafeProviderConfig,
} from "./aiProviderHub.service";

function row(over: Partial<Parameters<typeof toSafeProviderConfig>[0]> = {}) {
  return {
    id: "p1",
    scope: SecretScope.PLATFORM,
    tenantId: null,
    provider: AiProviderKey.OPENAI,
    kind: AiProviderKind.TEXT,
    label: "Prod OpenAI",
    secretId: null,
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini"],
    baseUrl: null,
    priority: 100,
    isDefault: false,
    status: AiProviderStatus.ACTIVE,
    metadata: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
    ...over,
  };
}

describe("deriveProviderContext (reused from vault)", () => {
  it("maps roles to scopes", () => {
    expect(deriveProviderContext(UserRole.SUPER_ADMIN, "t")).toEqual({
      scope: SecretScope.PLATFORM,
      tenantId: null,
    });
    expect(deriveProviderContext(UserRole.WHITE_LABEL_ADMIN, "p1")).toEqual({
      scope: SecretScope.PARTNER,
      tenantId: "p1",
    });
    expect(deriveProviderContext(UserRole.BUSINESS_ADMIN, "c1")).toEqual({
      scope: SecretScope.CUSTOMER,
      tenantId: "c1",
    });
  });
  it("rejects disallowed roles", () => {
    expect(() => deriveProviderContext(UserRole.AGENT, "c1")).toThrow(ApiError);
  });
});

describe("toSafeProviderConfig", () => {
  it("derives hasKey from secretId and parses metadata", () => {
    const safe = toSafeProviderConfig(
      row({ secretId: "sv_123", metadata: '{"region":"us"}' }),
    );
    expect(safe.hasKey).toBe(true);
    expect(safe.metadata).toEqual({ region: "us" });
  });
  it("hasKey false when no secret", () => {
    expect(toSafeProviderConfig(row()).hasKey).toBe(false);
  });
});

describe("orderProviderChain", () => {
  it("drops DISABLED configs", () => {
    const chain = orderProviderChain([
      row({ id: "a", status: AiProviderStatus.DISABLED }),
      row({ id: "b", status: AiProviderStatus.ACTIVE }),
    ]);
    expect(chain.map((c) => c.id)).toEqual(["b"]);
  });

  it("puts the default first, then ascending priority", () => {
    const chain = orderProviderChain([
      row({ id: "low", priority: 50, isDefault: false }),
      row({ id: "def", priority: 200, isDefault: true }),
      row({ id: "hi", priority: 150, isDefault: false }),
    ]);
    expect(chain.map((c) => c.id)).toEqual(["def", "low", "hi"]);
  });

  it("breaks priority ties by oldest first", () => {
    const chain = orderProviderChain([
      row({ id: "new", priority: 100, createdAt: new Date("2026-02-01") }),
      row({ id: "old", priority: 100, createdAt: new Date("2026-01-01") }),
    ]);
    expect(chain.map((c) => c.id)).toEqual(["old", "new"]);
  });

  it("does not mutate the input array", () => {
    const input = [row({ id: "a", priority: 200 }), row({ id: "b", priority: 1 })];
    const before = input.map((c) => c.id);
    orderProviderChain(input);
    expect(input.map((c) => c.id)).toEqual(before);
  });
});
