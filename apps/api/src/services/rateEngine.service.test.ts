import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rateFindFirst: vi.fn(),
  ruleFindMany: vi.fn(),
  usageFindUnique: vi.fn(),
  usageCreate: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    whatsAppRateTable: {
      findFirst: mocks.rateFindFirst,
    },
    partnerRateRule: {
      findMany: mocks.ruleFindMany,
    },
    usageEvent: {
      findUnique: mocks.usageFindUnique,
      create: mocks.usageCreate,
    },
  },
  UsageEventKind: {
    WHATSAPP_MESSAGE: "WHATSAPP_MESSAGE",
    AI_CALL: "AI_CALL",
  },
  UsageEventStatus: {
    QUOTED: "QUOTED",
    AUTHORIZED: "AUTHORIZED",
    DEBITED: "DEBITED",
    BLOCKED: "BLOCKED",
    FAILED: "FAILED",
  },
  WhatsAppProviderKey: {
    META: "META",
    GUPSHUP: "GUPSHUP",
    DIALOG_360: "DIALOG_360",
    TWILIO: "TWILIO",
    HAPTIK: "HAPTIK",
  },
  WhatsAppUsageCategory: {
    MARKETING: "MARKETING",
    UTILITY: "UTILITY",
    AUTHENTICATION: "AUTHENTICATION",
    SERVICE: "SERVICE",
  },
}));

const rateRow = {
  id: "rate_in_marketing_meta",
  countryCode: "IN",
  category: "MARKETING" as never,
  providerKey: "META" as never,
  currency: "INR",
  baseCostMicros: 800_000n,
  providerCostMicros: 100_000n,
  taxBps: 1800,
  gatewayFeeBps: 200,
};

describe("rateEngine.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculates provider cost, partner markup, tax, gateway fee and wallet credits", async () => {
    const { calculateWhatsAppQuote } = await import("./rateEngine.service");

    const quote = calculateWhatsAppQuote({
      rate: rateRow,
      partnerRule: {
        id: "rule_partner_1",
        markupBps: 1500,
        fixedMarkupMicros: 50_000n,
      },
      units: 2,
      creditUnitMicros: 1_000_000n,
    });

    // Per unit: 0.80 + 0.10 = 0.90 INR. For two units = 1.80.
    // Markup: 15% of 1.80 = 0.27 + fixed 0.05 * 2 = 0.37.
    // Subtotal 2.17. Tax 18% = 0.3906. Gateway 2% = 0.0434.
    expect(quote.subtotalMicros).toBe(2_170_000n);
    expect(quote.taxMicros).toBe(390_600n);
    expect(quote.gatewayFeeMicros).toBe(43_400n);
    expect(quote.totalCostMicros).toBe(2_604_000n);
    expect(quote.walletDebitCredits).toBe(3);
    expect(quote.partnerRateRuleId).toBe("rule_partner_1");
  });

  it("supports currency conversion before wallet credit rounding", async () => {
    const { calculateWhatsAppQuote } = await import("./rateEngine.service");

    const quote = calculateWhatsAppQuote({
      rate: {
        ...rateRow,
        currency: "USD",
        baseCostMicros: 10_000n, // $0.01
        providerCostMicros: 0n,
        taxBps: 0,
        gatewayFeeBps: 0,
      },
      units: 10,
      walletCurrency: "INR",
      // 1 USD = 83 INR
      currencyRateMicros: 83_000_000n,
      creditUnitMicros: 1_000_000n,
    });

    expect(quote.totalCostMicros).toBe(100_000n); // $0.10
    expect(quote.walletCostMicros).toBe(8_300_000n); // ₹8.30
    expect(quote.walletDebitCredits).toBe(9);
  });

  it("falls back to DEFAULT country rates and persists idempotent UsageEvents", async () => {
    mocks.usageFindUnique.mockResolvedValue(null);
    mocks.rateFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...rateRow, countryCode: "DEFAULT" });
    mocks.ruleFindMany.mockResolvedValue([]);
    mocks.usageCreate.mockImplementation(async ({ data }) => ({
      id: "usage_1",
      ...data,
      createdAt: new Date("2026-06-03T10:00:00Z"),
      updatedAt: new Date("2026-06-03T10:00:00Z"),
    }));

    const { quoteWhatsAppUsage } = await import("./rateEngine.service");
    const result = await quoteWhatsAppUsage({
      tenantId: "tenant_1",
      countryCode: "US",
      category: "MARKETING" as never,
      providerKey: "META" as never,
      source: "campaign",
      referenceType: "Campaign",
      referenceId: "camp_1",
      content: "June offer",
      persist: true,
      now: new Date("2026-06-03T00:00:00Z"),
    });

    expect(mocks.rateFindFirst).toHaveBeenCalledTimes(2);
    expect(mocks.rateFindFirst.mock.calls[0][0].where.countryCode).toBe("US");
    expect(mocks.rateFindFirst.mock.calls[1][0].where.countryCode).toBe("DEFAULT");
    expect(result.usageEvent?.tenantId).toBe("tenant_1");
    expect(result.usageEvent?.countryCode).toBe("US");
    expect(result.usageEvent?.rateTableId).toBe("rate_in_marketing_meta");
    expect(result.idempotent).toBe(false);
  });

  it("selects the most specific partner rule within the lowest priority", async () => {
    mocks.usageFindUnique.mockResolvedValue(null);
    mocks.rateFindFirst.mockResolvedValue(rateRow);
    mocks.ruleFindMany.mockResolvedValue([
      {
        id: "rule_wildcard",
        partnerTenantId: "partner_1",
        customerTenantId: null,
        countryCode: null,
        category: null,
        providerKey: null,
        markupBps: 500,
        fixedMarkupMicros: 0n,
        priority: 10,
      },
      {
        id: "rule_customer_country",
        partnerTenantId: "partner_1",
        customerTenantId: "tenant_1",
        countryCode: "IN",
        category: null,
        providerKey: null,
        markupBps: 900,
        fixedMarkupMicros: 0n,
        priority: 10,
      },
    ]);

    const { quoteWhatsAppUsage } = await import("./rateEngine.service");
    const result = await quoteWhatsAppUsage({
      tenantId: "tenant_1",
      partnerTenantId: "partner_1",
      countryCode: "IN",
      category: "MARKETING" as never,
      providerKey: "META" as never,
    });

    expect(result.quote?.partnerRateRuleId).toBe("rule_customer_country");
    expect(result.quote?.partnerMarkupBps).toBe(900);
  });

  it("reuses an existing persisted UsageEvent for the same idempotency key", async () => {
    mocks.usageFindUnique.mockResolvedValue({
      id: "usage_existing",
      tenantId: "tenant_1",
      idempotencyKey: "idem_1",
    });

    const { quoteWhatsAppUsage } = await import("./rateEngine.service");
    const result = await quoteWhatsAppUsage({
      tenantId: "tenant_1",
      countryCode: "IN",
      category: "MARKETING" as never,
      providerKey: "META" as never,
      idempotencyKey: "idem_1",
      persist: true,
    });

    expect(result.idempotent).toBe(true);
    expect(result.usageEvent?.id).toBe("usage_existing");
    expect(mocks.rateFindFirst).not.toHaveBeenCalled();
    expect(mocks.usageCreate).not.toHaveBeenCalled();
  });
});
