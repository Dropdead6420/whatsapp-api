import { describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  partnerProductAccessFindUnique: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    product: {
      findUnique: vi.fn(async (args) => {
        if (args?.where?.key === "missing") return null;
        return {
          id: "prod_1",
          key: args?.where?.key ?? "ai_agents",
          isGlobalEnabled: true,
        };
      }),
    },
    partnerProductAccess: {
      findUnique: dbMocks.partnerProductAccessFindUnique,
    },
  },
  ProductAccessSource: {
    GLOBAL: "GLOBAL",
    SUPER_ADMIN: "SUPER_ADMIN",
    PARTNER: "PARTNER",
    PLAN: "PLAN",
    LEGACY: "LEGACY",
  },
  TenantStatus: {
    ACTIVE: "ACTIVE",
    DELETED: "DELETED",
  },
  TenantType: {
    DIRECT: "DIRECT",
    WHITE_LABEL: "WHITE_LABEL",
    BUSINESS: "BUSINESS",
  },
}));

import { ProductAccessSource } from "@nexaflow/db";
import {
  assertPartnerCanGrantProduct,
  resolveProductAccessForTenantContext,
} from "./productAccess.service";

const baseProduct = {
  id: "prod_1",
  key: "ai_agents",
  name: "AI Agents",
  category: "AI",
  description: "Agent builder",
  routeHref: "/dashboard/ai-agents",
  featureKey: "aiAgents",
  icon: "bot",
  isGlobalEnabled: true,
};

describe("resolveProductAccessForTenantContext", () => {
  it("global disabled blocks everyone", () => {
    const [product] = resolveProductAccessForTenantContext({
      tenant: {
        id: "tenant_1",
        type: "BUSINESS",
        parentTenantId: null,
        featuresEnabled: null,
      },
      products: [{ ...baseProduct, isGlobalEnabled: false }],
      partnerAccesses: [],
      customerAccesses: [
        {
          productId: "prod_1",
          enabled: true,
          limits: null,
          source: ProductAccessSource.SUPER_ADMIN,
        },
      ],
    });

    expect(product.enabled).toBe(false);
    expect(product.source).toBe("GLOBAL");
    expect(product.disabledReason).toContain("globally");
  });

  it("partner disabled blocks all child customers even when customer row is enabled", () => {
    const [product] = resolveProductAccessForTenantContext({
      tenant: {
        id: "customer_1",
        type: "BUSINESS",
        parentTenantId: "partner_1",
        featuresEnabled: null,
      },
      products: [baseProduct],
      partnerAccesses: [
        {
          productId: "prod_1",
          enabled: false,
          limits: null,
          source: ProductAccessSource.SUPER_ADMIN,
        },
      ],
      customerAccesses: [
        {
          productId: "prod_1",
          enabled: true,
          limits: null,
          source: ProductAccessSource.PARTNER,
        },
      ],
    });

    expect(product.enabled).toBe(false);
    expect(product.disabledReason).toContain("Partner");
  });

  it("missing partner access blocks child customers", () => {
    const [product] = resolveProductAccessForTenantContext({
      tenant: {
        id: "customer_1",
        type: "BUSINESS",
        parentTenantId: "partner_1",
        featuresEnabled: null,
      },
      products: [baseProduct],
      partnerAccesses: [],
      customerAccesses: [
        {
          productId: "prod_1",
          enabled: true,
          limits: null,
          source: ProductAccessSource.PARTNER,
        },
      ],
    });

    expect(product.enabled).toBe(false);
    expect(product.disabledReason).toContain("not enabled");
  });

  it("customer disabled hides UI and blocks API even when partner is enabled", () => {
    const [product] = resolveProductAccessForTenantContext({
      tenant: {
        id: "customer_1",
        type: "BUSINESS",
        parentTenantId: "partner_1",
        featuresEnabled: null,
      },
      products: [baseProduct],
      partnerAccesses: [
        {
          productId: "prod_1",
          enabled: true,
          limits: { seats: 5 },
          source: ProductAccessSource.SUPER_ADMIN,
        },
      ],
      customerAccesses: [
        {
          productId: "prod_1",
          enabled: false,
          limits: null,
          source: ProductAccessSource.PARTNER,
        },
      ],
    });

    expect(product.enabled).toBe(false);
    expect(product.source).toBe("PARTNER");
    expect(product.limits).toEqual({ seats: 5 });
    expect(product.disabledReason).toContain("Customer");
  });

  it("direct customers use global access when no explicit customer row exists", () => {
    const [product] = resolveProductAccessForTenantContext({
      tenant: {
        id: "direct_1",
        type: "DIRECT",
        parentTenantId: null,
        featuresEnabled: null,
      },
      products: [baseProduct],
      partnerAccesses: [],
      customerAccesses: [],
    });

    expect(product.enabled).toBe(true);
    expect(product.source).toBe("GLOBAL");
  });

  it("legacy featuresEnabled fallback still disables existing tenants", () => {
    const [product] = resolveProductAccessForTenantContext({
      tenant: {
        id: "tenant_1",
        type: "BUSINESS",
        parentTenantId: null,
        featuresEnabled: JSON.stringify({ aiAgents: false }),
      },
      products: [baseProduct],
      partnerAccesses: [],
      customerAccesses: [],
    });

    expect(product.enabled).toBe(false);
    expect(product.source).toBe("LEGACY");
  });
});

describe("assertPartnerCanGrantProduct", () => {
  it("throws when the partner has no explicit product entitlement", async () => {
    dbMocks.partnerProductAccessFindUnique.mockResolvedValueOnce(null);

    await expect(
      assertPartnerCanGrantProduct("partner_1", "ai_agents"),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining("not enabled"),
    });
  });

  it("throws when the partner entitlement is disabled", async () => {
    dbMocks.partnerProductAccessFindUnique.mockResolvedValueOnce({
      productId: "prod_1",
      enabled: false,
      limits: null,
      source: ProductAccessSource.SUPER_ADMIN,
      expiresAt: null,
    });

    await expect(
      assertPartnerCanGrantProduct("partner_1", "ai_agents"),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining("disabled"),
    });
  });

  it("throws when the partner entitlement is expired", async () => {
    dbMocks.partnerProductAccessFindUnique.mockResolvedValueOnce({
      productId: "prod_1",
      enabled: true,
      limits: null,
      source: ProductAccessSource.SUPER_ADMIN,
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      assertPartnerCanGrantProduct("partner_1", "ai_agents"),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining("expired"),
    });
  });

  it("allows active explicit partner entitlement", async () => {
    dbMocks.partnerProductAccessFindUnique.mockResolvedValueOnce({
      productId: "prod_1",
      enabled: true,
      limits: { seats: 5 },
      source: ProductAccessSource.SUPER_ADMIN,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      assertPartnerCanGrantProduct("partner_1", "ai_agents"),
    ).resolves.toMatchObject({
      product: { id: "prod_1", key: "ai_agents" },
      partnerAccess: { enabled: true },
    });
  });
});
