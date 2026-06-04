import { describe, expect, it } from "vitest";
import { summarizeAdminBillingSubscriptions } from "./adminBillingOverview.service";

describe("adminBillingOverview.service", () => {
  it("normalizes platform MRR and splits direct vs partner subscriptions", () => {
    const summary = summarizeAdminBillingSubscriptions(
      [
        {
          status: "ACTIVE",
          tenant: { id: "direct-customer", parentTenant: null },
          plan: {
            id: "growth",
            name: "GROWTH",
            displayName: "Growth",
            priceInPaisa: 5_000,
            billingCycle: "monthly",
          },
        },
        {
          status: "ACTIVE",
          tenant: {
            id: "partner-customer",
            parentTenant: {
              id: "partner-a",
              name: "Partner A",
              partnerMarginEnabled: true,
            },
          },
          plan: {
            id: "pro",
            name: "PRO",
            displayName: "Pro",
            priceInPaisa: 120_000,
            billingCycle: "annual",
          },
        },
        {
          status: "CANCELLED",
          tenant: { id: "old-customer", parentTenant: null },
          plan: {
            id: "starter",
            name: "STARTER",
            displayName: "Starter",
            priceInPaisa: 2_000,
            billingCycle: "monthly",
          },
        },
      ],
      { partnerMarginBps: 2000 },
    );

    expect(summary.activeSubscriptions).toBe(2);
    expect(summary.activeMrrInPaisa).toBe(15_000);
    expect(summary.directMrrInPaisa).toBe(5_000);
    expect(summary.partnerMrrInPaisa).toBe(10_000);
    expect(summary.partnerAgencyProfitInPaisa).toBe(2_000);
    expect(summary.partnerSummaries).toEqual([
      {
        partnerTenantId: "partner-a",
        partnerName: "Partner A",
        customerCount: 1,
        activeSubscriptions: 1,
        baseMrrInPaisa: 10_000,
        agencyProfitInPaisa: 2_000,
        partnerMarginEnabled: true,
        partnerMarginBps: 2000,
        planBreakdown: [
          {
            planId: "pro",
            name: "Pro",
            count: 1,
            mrrInPaisa: 10_000,
          },
        ],
      },
    ]);
  });

  it("keeps partner profit at zero when margin is disabled", () => {
    const summary = summarizeAdminBillingSubscriptions(
      [
        {
          status: "ACTIVE",
          tenant: {
            id: "partner-customer",
            parentTenant: {
              id: "partner-a",
              name: "Partner A",
              partnerMarginEnabled: false,
            },
          },
          plan: {
            id: "growth",
            name: "GROWTH",
            displayName: "Growth",
            priceInPaisa: 5_000,
            billingCycle: "monthly",
          },
        },
      ],
      { partnerMarginBps: 2000 },
    );

    expect(summary.partnerMrrInPaisa).toBe(5_000);
    expect(summary.partnerAgencyProfitInPaisa).toBe(0);
    expect(summary.partnerSummaries[0]?.partnerMarginBps).toBe(0);
  });
});
