import { describe, expect, it } from "vitest";
import {
  monthlyPriceInPaisa,
  normalizePartnerMarginBps,
  summarizePartnerBilling,
} from "./partnerDashboard.service";

describe("partnerDashboard.service", () => {
  it("normalizes annual pricing into monthly recurring revenue", () => {
    expect(monthlyPriceInPaisa(120_000, "annual")).toBe(10_000);
    expect(monthlyPriceInPaisa(120_000, "YEARLY")).toBe(10_000);
    expect(monthlyPriceInPaisa(4_500, "monthly")).toBe(4_500);
  });

  it("dedupes each customer to the latest active subscription and groups plans", () => {
    const summary = summarizePartnerBilling(
      [
        {
          tenantId: "tenant-a",
          planId: "starter",
          planName: "STARTER",
          displayName: "Starter Suite",
          priceInPaisa: 2_500,
          billingCycle: "monthly",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        {
          tenantId: "tenant-a",
          planId: "growth",
          planName: "GROWTH",
          displayName: "Growth Booster",
          priceInPaisa: 5_000,
          billingCycle: "monthly",
          updatedAt: "2026-02-01T00:00:00Z",
        },
        {
          tenantId: "tenant-b",
          planId: "growth",
          planName: "GROWTH",
          displayName: "Growth Booster",
          priceInPaisa: 60_000,
          billingCycle: "annual",
          updatedAt: "2026-02-02T00:00:00Z",
        },
        {
          tenantId: "tenant-c",
          planId: "pro",
          planName: "PRO",
          displayName: "Pro",
          priceInPaisa: 10_000,
          billingCycle: "monthly",
          updatedAt: "2026-02-03T00:00:00Z",
        },
      ],
      { partnerMarginEnabled: true, partnerMarginBps: 1500 },
    );

    expect(summary.activeSubscriptionCount).toBe(3);
    expect(summary.baseMrrInPaisa).toBe(20_000);
    expect(summary.agencyProfitInPaisa).toBe(3_000);
    expect(summary.planDistribution).toEqual([
      {
        planId: "growth",
        name: "Growth Booster",
        count: 2,
        percentage: 66.7,
        mrrInPaisa: 10_000,
      },
      {
        planId: "pro",
        name: "Pro",
        count: 1,
        percentage: 33.3,
        mrrInPaisa: 10_000,
      },
    ]);
  });

  it("turns off agency profit when partner margin is disabled", () => {
    const summary = summarizePartnerBilling(
      [
        {
          tenantId: "tenant-a",
          planId: "growth",
          planName: "GROWTH",
          displayName: "Growth",
          priceInPaisa: 5_000,
          billingCycle: "monthly",
        },
      ],
      { partnerMarginEnabled: false, partnerMarginBps: 1500 },
    );

    expect(summary.partnerMarginBps).toBe(0);
    expect(summary.agencyProfitInPaisa).toBe(0);
  });

  it("clamps invalid margin values", () => {
    expect(normalizePartnerMarginBps(-20)).toBe(0);
    expect(normalizePartnerMarginBps(20_000)).toBe(10_000);
    expect(normalizePartnerMarginBps(Number.NaN)).toBe(1500);
  });
});
