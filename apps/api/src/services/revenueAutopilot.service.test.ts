import { describe, expect, it } from "vitest";
import { CustomerHealthTier } from "@nexaflow/db";
import { rankRevenueOpportunities } from "./revenueAutopilot.service";

function sig(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    name: "Acme Co",
    contactLimit: 1000,
    campaignLimit: 100,
    aiCreditsPerMonth: 1000,
    contactCount: 100,
    campaignCount: 10,
    balanceCredits: 5000,
    autoRechargeEnabled: false,
    healthTier: CustomerHealthTier.HEALTHY,
    healthScore: 70,
    recommendation: null,
    // Cast at use; tests need flexibility for tier types.
    ...overrides,
  } as Parameters<typeof rankRevenueOpportunities>[0][number];
}

describe("rankRevenueOpportunities", () => {
  it("returns empty when no signals fire", () => {
    // Healthy mid-plan tenant with room — no rule matches.
    const recs = rankRevenueOpportunities([sig()]);
    expect(recs).toEqual([]);
  });

  it("prioritizes AT_RISK rescue over plan-quota upsell", () => {
    const recs = rankRevenueOpportunities([
      sig({
        healthTier: CustomerHealthTier.AT_RISK,
        healthScore: 45,
        // also near quota — but we save the customer first
        contactCount: 950,
      }),
    ]);
    expect(recs).toHaveLength(1);
    expect(recs[0].action).toBe("outreach_at_risk");
    expect(recs[0].priority).toBeGreaterThanOrEqual(80);
  });

  it("uses the persisted health recommendation as rationale when available", () => {
    const recs = rankRevenueOpportunities([
      sig({
        healthTier: CustomerHealthTier.AT_RISK,
        healthScore: 45,
        recommendation: "Re-engage with a win-back campaign — 0 messages in 21d.",
      }),
    ]);
    expect(recs[0].rationale).toContain("win-back");
  });

  it("flags plan-upgrade at 85%+ quota usage", () => {
    const recs = rankRevenueOpportunities([
      sig({
        contactCount: 900,
        contactLimit: 1000, // 90%
      }),
    ]);
    expect(recs[0].action).toBe("upgrade_plan");
    expect(recs[0].rationale).toMatch(/900\/1000/);
  });

  it("picks the TIGHTEST quota when both contacts + campaigns are tight", () => {
    const recs = rankRevenueOpportunities([
      sig({
        contactCount: 850, // 85%
        campaignCount: 95, // 95% — tighter
        contactLimit: 1000,
        campaignLimit: 100,
      }),
    ]);
    expect(recs[0].rationale).toContain("campaigns");
    expect(recs[0].rationale).toContain("95");
  });

  it("does NOT recommend recharge when auto-recharge is on", () => {
    const recs = rankRevenueOpportunities([
      sig({
        balanceCredits: 100,
        autoRechargeEnabled: true, // self-managing
        healthTier: CustomerHealthTier.HEALTHY,
      }),
    ]);
    // Falls through to nothing — auto-recharge handles it.
    expect(recs).toEqual([]);
  });

  it("recommends wallet recharge for low-balance healthy tenants", () => {
    const recs = rankRevenueOpportunities([
      sig({
        balanceCredits: 200,
        autoRechargeEnabled: false,
        healthTier: CustomerHealthTier.HEALTHY,
        healthScore: 75,
      }),
    ]);
    expect(recs[0].action).toBe("wallet_recharge");
    expect(recs[0].rationale).toMatch(/200/);
  });

  it("recommends enabling auto-recharge for THRIVING manual managers", () => {
    const recs = rankRevenueOpportunities([
      sig({
        balanceCredits: 2000,
        autoRechargeEnabled: false,
        healthTier: CustomerHealthTier.THRIVING,
        healthScore: 92,
      }),
    ]);
    expect(recs[0].action).toBe("enable_auto_recharge");
  });

  it("recommends expansion add-on for THRIVING tenants with room", () => {
    const recs = rankRevenueOpportunities([
      sig({
        balanceCredits: 2000,
        autoRechargeEnabled: true, // self-managing → skip recharge prompts
        healthTier: CustomerHealthTier.THRIVING,
        healthScore: 90,
        contactCount: 300,
        contactLimit: 1000,
      }),
    ]);
    expect(recs[0].action).toBe("expansion_addon");
  });

  it("orders results by priority desc and caps the list", () => {
    const recs = rankRevenueOpportunities(
      [
        sig({ id: "t1", healthTier: CustomerHealthTier.AT_RISK }),
        sig({ id: "t2", contactCount: 990, contactLimit: 1000 }),
        sig({
          id: "t3",
          balanceCredits: 100,
          healthTier: CustomerHealthTier.HEALTHY,
        }),
        sig({
          id: "t4",
          healthTier: CustomerHealthTier.THRIVING,
          balanceCredits: 5000,
          autoRechargeEnabled: true,
        }),
      ],
      3,
    );
    expect(recs).toHaveLength(3);
    expect(recs[0].priority).toBeGreaterThanOrEqual(recs[1].priority);
    expect(recs[1].priority).toBeGreaterThanOrEqual(recs[2].priority);
    // The AT_RISK rescue should be first.
    expect(recs[0].tenantId).toBe("t1");
  });

  it("ignores tenants with no actionable signal — CHURNING isn't upsellable", () => {
    // Customer Health already pushes for churning; revenue autopilot
    // stays out of that lane.
    const recs = rankRevenueOpportunities([
      sig({
        healthTier: CustomerHealthTier.CHURNING,
        healthScore: 20,
      }),
    ]);
    expect(recs).toEqual([]);
  });

  it("treats limit=0 as unlimited (does not trigger upgrade)", () => {
    const recs = rankRevenueOpportunities([
      sig({
        contactCount: 100000,
        contactLimit: 0,
        campaignCount: 100000,
        campaignLimit: 0,
      }),
    ]);
    // No quota signal fires — falls through to other rules.
    expect(recs.some((r) => r.action === "upgrade_plan")).toBe(false);
  });
});
