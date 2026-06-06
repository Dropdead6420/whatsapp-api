import { describe, expect, it } from "vitest";
import { IntegrationProvider } from "@nexaflow/db";
import {
  CONNECTOR_CATALOG,
  getConnector,
  getConnectorCatalog,
  toSafeIntegration,
} from "./integrations.service";

describe("connector catalog", () => {
  it("covers every IntegrationProvider exactly once", () => {
    const providers = CONNECTOR_CATALOG.map((c) => c.provider).sort();
    const enumValues = Object.values(IntegrationProvider).sort();
    expect(providers).toEqual(enumValues);
  });

  it("each connector has a valid authType + category", () => {
    for (const c of getConnectorCatalog()) {
      expect(["apikey", "oauth", "webhook"]).toContain(c.authType);
      expect(["ecommerce", "productivity", "automation", "payments", "custom"]).toContain(
        c.category,
      );
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it("getConnector resolves a known provider and returns undefined otherwise", () => {
    expect(getConnector(IntegrationProvider.SHOPIFY)?.name).toBe("Shopify");
    expect(getConnector("NOPE" as IntegrationProvider)).toBeUndefined();
  });
});

describe("toSafeIntegration", () => {
  const base = {
    id: "i1",
    tenantId: "t1",
    provider: IntegrationProvider.ZAPIER,
    label: "My Zap",
    config: { hookUrl: "https://hooks.zapier.com/x" },
    secretId: null as string | null,
    externalAccountLabel: null,
    status: "CONNECTED" as const,
    lastSyncedAt: null,
    error: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
  };

  it("never exposes the raw secretId; only a hasCredential flag", () => {
    const safe = toSafeIntegration({ ...base, secretId: "sv_123" });
    expect(safe.hasCredential).toBe(true);
    expect((safe as Record<string, unknown>).secretId).toBeUndefined();
  });

  it("hasCredential is false without a linked secret", () => {
    expect(toSafeIntegration(base).hasCredential).toBe(false);
    expect(toSafeIntegration(base).config).toEqual({ hookUrl: "https://hooks.zapier.com/x" });
  });
});
