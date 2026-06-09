import { describe, expect, it } from "vitest";
import {
  actionRate,
  deriveInsightTotals,
  summarizeInsights,
  toSafeInsight,
} from "./gmbInsights.service";

const metrics = {
  mapsViews: 100,
  searchViews: 150,
  directSearches: 40,
  discoverySearches: 30,
  brandedSearches: 10,
  callClicks: 12,
  websiteClicks: 20,
  directionRequests: 8,
  messageClicks: 5,
  bookingClicks: 5,
  photoViews: 60,
};

describe("deriveInsightTotals", () => {
  it("rolls low-level metrics into headline totals", () => {
    const t = deriveInsightTotals(metrics);
    expect(t.totalViews).toBe(250); // 100 + 150
    expect(t.totalSearches).toBe(80); // 40 + 30 + 10
    expect(t.totalActions).toBe(50); // 12 + 20 + 8 + 5 + 5
  });
});

describe("actionRate", () => {
  it("is actions over views, rounded to 4 dp", () => {
    expect(actionRate(50, 250)).toBe(0.2);
    expect(actionRate(1, 3)).toBe(0.3333);
  });
  it("is zero when there are no views", () => {
    expect(actionRate(5, 0)).toBe(0);
  });
});

describe("toSafeInsight", () => {
  it("exposes metrics + derived totals + actionRate, hides tenantId", () => {
    const safe = toSafeInsight({
      id: "i1",
      tenantId: "t1",
      locationId: "loc1",
      periodStart: new Date("2026-05-01"),
      periodEnd: new Date("2026-05-31"),
      source: "manual",
      createdAt: new Date("2026-06-01"),
      updatedAt: new Date("2026-06-01"),
      ...metrics,
    });
    expect(safe.totalViews).toBe(250);
    expect(safe.totalActions).toBe(50);
    expect(safe.actionRate).toBe(0.2);
    expect(safe.callClicks).toBe(12);
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
  });
});

describe("summarizeInsights", () => {
  it("sums across periods and computes range + totals", () => {
    const summary = summarizeInsights([
      { ...metrics, periodStart: "2026-05-01", periodEnd: "2026-05-31" },
      { ...metrics, periodStart: "2026-04-01", periodEnd: "2026-04-30" },
    ]);
    expect(summary.periods).toBe(2);
    expect(summary.mapsViews).toBe(200);
    expect(summary.totalViews).toBe(500);
    expect(summary.totalActions).toBe(100);
    expect(summary.actionRate).toBe(0.2);
    expect(summary.rangeStart).toEqual(new Date("2026-04-01"));
    expect(summary.rangeEnd).toEqual(new Date("2026-05-31"));
  });

  it("returns a zeroed summary for no snapshots", () => {
    const summary = summarizeInsights([]);
    expect(summary.periods).toBe(0);
    expect(summary.totalViews).toBe(0);
    expect(summary.actionRate).toBe(0);
    expect(summary.rangeStart).toBeNull();
    expect(summary.rangeEnd).toBeNull();
  });
});
