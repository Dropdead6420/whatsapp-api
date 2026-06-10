import { describe, expect, it } from "vitest";
import { GmbReportType } from "@nexaflow/db";
import { buildActionPlan, buildReportNarrative, toSafeReport, type ReportSnapshot } from "./gmbReport.service";

const healthy: ReportSnapshot = {
  reviews: { count: 20, average: 4.6, unanswered: 0 },
  insights: { totalViews: 1000, totalActions: 200, actionRate: 0.2 },
  ranking: { trackedKeywords: 5, top3: 5, top10: 5, notFound: 0 },
  citations: { total: 6, consistent: 6 },
  posts: { created: 8 },
};

const struggling: ReportSnapshot = {
  reviews: { count: 10, average: 3.2, unanswered: 4 },
  insights: { totalViews: 300, totalActions: 9, actionRate: 0.03 },
  ranking: { trackedKeywords: 4, top3: 1, top10: 2, notFound: 1 },
  citations: { total: 5, consistent: 2 },
  posts: { created: 1 },
};

describe("buildReportNarrative", () => {
  it("weaves the headline metrics into a sentence", () => {
    const text = buildReportNarrative(healthy);
    expect(text).toContain("20 review(s)");
    expect(text).toContain("4.6★");
    expect(text).toContain("1000 views");
    expect(text).toContain("20% action rate");
    expect(text).toContain("6/6 citation(s)");
  });
});

describe("buildActionPlan", () => {
  it("returns no action items for a healthy profile", () => {
    // healthy has 0 unanswered, rating >= 4, all keywords top3, citations consistent, 8 posts
    expect(buildActionPlan(healthy)).toEqual([]);
  });

  it("prioritizes fixes for a struggling profile", () => {
    const plan = buildActionPlan(struggling);
    const areas = plan.map((p) => p.area);
    expect(areas).toContain("reputation"); // unanswered + low rating
    expect(areas).toContain("ranking"); // not all in top 3
    expect(areas).toContain("citations"); // 3 inconsistent
    expect(areas).toContain("content"); // < 4 posts
    // unanswered reviews + low rating are both high priority
    expect(plan.filter((p) => p.priority === "high").length).toBeGreaterThanOrEqual(2);
    expect(plan.find((p) => p.area === "citations")?.task).toContain("3");
  });
});

describe("toSafeReport", () => {
  it("exposes report fields but hides tenantId / generatedByUserId", () => {
    const safe = toSafeReport({
      id: "r1",
      tenantId: "t1",
      locationId: "loc1",
      type: GmbReportType.MONTHLY,
      periodStart: new Date("2026-05-01"),
      periodEnd: new Date("2026-05-31"),
      data: { posts: { created: 3 } },
      summary: "All good",
      actionPlan: [],
      createdAt: new Date("2026-06-01"),
    });
    expect(safe.type).toBe("MONTHLY");
    expect(safe.summary).toBe("All good");
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
    expect((safe as Record<string, unknown>).generatedByUserId).toBeUndefined();
  });
});
