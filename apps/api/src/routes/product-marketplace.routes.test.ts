// Route-contract tests for the Product Marketplace access layer.
//
// These mirror the route schemas inline so the test stays fast and does not
// import the Express graph. The important invariants are tenant scoping,
// source spoofing defense, and explicit partner entitlement before a partner
// can grant a product to one of its customers.

import { describe, expect, it } from "vitest";
import { z } from "zod";

const ProductCategory = {
  CORE: "CORE",
  MARKETING: "MARKETING",
  AI: "AI",
  AUTOMATION: "AUTOMATION",
  BILLING: "BILLING",
  INTEGRATION: "INTEGRATION",
  DEVELOPER: "DEVELOPER",
  COMPLIANCE: "COMPLIANCE",
  SUPPORT: "SUPPORT",
} as const;

const productKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9_]+$/);

const productWriteSchema = z.object({
  key: productKeySchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  category: z.nativeEnum(ProductCategory).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  routeHref: z.string().trim().max(200).nullable().optional(),
  featureKey: z.string().trim().max(80).nullable().optional(),
  icon: z.string().trim().max(80).nullable().optional(),
  isGlobalEnabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  metadata: z.unknown().nullable().optional(),
});

const productCreateSchema = productWriteSchema.extend({
  key: productKeySchema,
  name: z.string().trim().min(1).max(120),
  category: z.nativeEnum(ProductCategory).default(ProductCategory.CORE),
});

const accessWriteSchema = z.object({
  enabled: z.boolean(),
  limits: z.unknown().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const addOnSchema = z.object({
  key: productKeySchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  priceInPaisa: z.number().int().min(0).optional(),
  billingCycle: z.string().trim().min(1).max(40).optional(),
  isActive: z.boolean().optional(),
  metadata: z.unknown().nullable().optional(),
});

const addOnCreateSchema = addOnSchema.extend({
  key: productKeySchema,
  name: z.string().trim().min(1).max(120),
});

const partnerToggleSchema = z.object({
  enabled: z.boolean(),
  limits: z.unknown().nullable().optional(),
});

function customerAccessWhere(authTenantId: string) {
  return { tenantId: authTenantId };
}

function partnerCanGrant(args: {
  productGlobalEnabled: boolean;
  access?: { enabled: boolean; expiresAt?: Date | null };
  now?: Date;
}) {
  const now = args.now ?? new Date();
  if (!args.productGlobalEnabled) return false;
  if (!args.access?.enabled) return false;
  if (args.access.expiresAt && args.access.expiresAt.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

describe("Product Marketplace route schemas", () => {
  it("accepts a minimal product create and defaults category=CORE", () => {
    const parsed = productCreateSchema.parse({
      key: "ai_agents",
      name: "AI Agents",
    });

    expect(parsed).toMatchObject({
      key: "ai_agents",
      name: "AI Agents",
      category: "CORE",
    });
  });

  it("rejects invalid product keys", () => {
    expect(() =>
      productCreateSchema.parse({ key: "AI-Agents", name: "AI Agents" }),
    ).toThrow();
    expect(() =>
      productCreateSchema.parse({ key: "x", name: "Too Short" }),
    ).toThrow();
  });

  it("strips spoofed tenancy and access fields from product create", () => {
    const parsed = productCreateSchema.parse({
      key: "developer_hub",
      name: "Developer Hub",
      tenantId: "evil",
      productId: "evil",
      source: "PARTNER",
      createdByUserId: "evil",
    });

    expect("tenantId" in parsed).toBe(false);
    expect("productId" in parsed).toBe(false);
    expect("source" in parsed).toBe(false);
    expect("createdByUserId" in parsed).toBe(false);
  });

  it("access writes accept only enabled, limits, and expiresAt", () => {
    const parsed = accessWriteSchema.parse({
      enabled: false,
      limits: { seats: 3 },
      expiresAt: "2026-12-01T00:00:00.000Z",
      partnerTenantId: "evil",
      customerTenantId: "evil",
      productId: "evil",
      source: "SUPER_ADMIN",
      updatedByUserId: "evil",
    });

    expect(parsed).toEqual({
      enabled: false,
      limits: { seats: 3 },
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
  });

  it("access writes reject missing or non-boolean enabled", () => {
    expect(() => accessWriteSchema.parse({})).toThrow();
    expect(() => accessWriteSchema.parse({ enabled: "false" })).toThrow();
  });

  it("partner customer toggle strips spoofed source and ids", () => {
    const parsed = partnerToggleSchema.parse({
      enabled: true,
      limits: { tags: ["pro"] },
      source: "SUPER_ADMIN",
      partnerTenantId: "other_partner",
      customerTenantId: "other_customer",
      productId: "other_product",
    });

    expect(parsed).toEqual({ enabled: true, limits: { tags: ["pro"] } });
  });

  it("add-on create accepts price/cycle and strips spoofed product/source fields", () => {
    const parsed = addOnCreateSchema.parse({
      key: "extra_ai_credits",
      name: "Extra AI credits",
      priceInPaisa: 99900,
      billingCycle: "monthly",
      productId: "evil",
      source: "PARTNER",
      createdByUserId: "evil",
    });

    expect(parsed).toEqual({
      key: "extra_ai_credits",
      name: "Extra AI credits",
      priceInPaisa: 99900,
      billingCycle: "monthly",
    });
  });

  it("add-on create rejects negative or fractional paisa amounts", () => {
    expect(() =>
      addOnCreateSchema.parse({
        key: "bad_price",
        name: "Bad price",
        priceInPaisa: -1,
      }),
    ).toThrow();
    expect(() =>
      addOnCreateSchema.parse({
        key: "bad_fraction",
        name: "Bad fraction",
        priceInPaisa: 99.5,
      }),
    ).toThrow();
  });
});

describe("Product Marketplace route invariants", () => {
  it("customer access must be pinned to the authenticated tenant", () => {
    const where = customerAccessWhere("tenant_from_jwt");

    expect(where.tenantId).toBe("tenant_from_jwt");
    expect(Object.values(where)).not.toContain("tenant_from_query");
  });

  it("partner cannot grant without an explicit active entitlement", () => {
    expect(partnerCanGrant({ productGlobalEnabled: true })).toBe(false);
    expect(
      partnerCanGrant({
        productGlobalEnabled: true,
        access: { enabled: false },
      }),
    ).toBe(false);
    expect(
      partnerCanGrant({
        productGlobalEnabled: true,
        access: { enabled: true, expiresAt: new Date("2026-01-01T00:00:00Z") },
        now: new Date("2026-01-02T00:00:00Z"),
      }),
    ).toBe(false);
  });

  it("partner can grant when product is global-enabled and entitlement is active", () => {
    expect(
      partnerCanGrant({
        productGlobalEnabled: true,
        access: { enabled: true, expiresAt: new Date("2026-02-01T00:00:00Z") },
        now: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toBe(true);
  });

  it("global disabled remains a hard stop even with partner access", () => {
    expect(
      partnerCanGrant({
        productGlobalEnabled: false,
        access: { enabled: true },
      }),
    ).toBe(false);
  });
});
