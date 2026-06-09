import { describe, expect, it } from "vitest";
import {
  rankBucket,
  summarizeRankTrend,
  toSafeKeyword,
  toSafeSnapshot,
} from "./gmbRanking.service";

describe("rankBucket", () => {
  it("classifies ranks into buckets", () => {
    expect(rankBucket(null)).toBe("not_found");
    expect(rankBucket(undefined)).toBe("not_found");
    expect(rankBucket(1)).toBe("top3");
    expect(rankBucket(3)).toBe("top3");
    expect(rankBucket(4)).toBe("top10");
    expect(rankBucket(10)).toBe("top10");
    expect(rankBucket(11)).toBe("beyond");
  });
});

describe("summarizeRankTrend", () => {
  it("returns a zeroed trend for no snapshots", () => {
    const t = summarizeRankTrend([]);
    expect(t).toEqual({
      latest: null,
      previous: null,
      delta: null,
      best: null,
      average: null,
      checks: 0,
      bucket: "not_found",
    });
  });

  it("sorts by checkedAt and computes movement (lower rank = better)", () => {
    const t = summarizeRankTrend([
      { rank: 5, checkedAt: "2026-06-01T00:00:00Z" },
      { rank: 3, checkedAt: "2026-06-03T00:00:00Z" }, // latest
      { rank: 8, checkedAt: "2026-05-28T00:00:00Z" },
    ]);
    expect(t.latest).toBe(3);
    expect(t.previous).toBe(5);
    expect(t.delta).toBe(2); // improved by 2 positions
    expect(t.best).toBe(3);
    expect(t.average).toBe(5.33);
    expect(t.checks).toBe(3);
    expect(t.bucket).toBe("top3");
  });

  it("handles a null latest rank (not found) and ignores nulls in best/avg", () => {
    const t = summarizeRankTrend([
      { rank: null, checkedAt: "2026-06-05T00:00:00Z" }, // latest
      { rank: 4, checkedAt: "2026-06-01T00:00:00Z" },
    ]);
    expect(t.latest).toBeNull();
    expect(t.delta).toBeNull();
    expect(t.best).toBe(4);
    expect(t.average).toBe(4);
    expect(t.bucket).toBe("not_found");
  });
});

describe("toSafeKeyword / toSafeSnapshot", () => {
  it("exposes keyword fields but hides tenantId", () => {
    const safe = toSafeKeyword({
      id: "kw1",
      tenantId: "t1",
      locationId: "loc1",
      keyword: "best coffee pune",
      isActive: true,
      createdAt: new Date("2026-06-01"),
      updatedAt: new Date("2026-06-01"),
    });
    expect(safe.keyword).toBe("best coffee pune");
    expect(safe.locationId).toBe("loc1");
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
  });

  it("derives a bucket on the snapshot and hides tenantId", () => {
    const safe = toSafeSnapshot({
      id: "s1",
      tenantId: "t1",
      keywordId: "kw1",
      rank: 2,
      source: "grid",
      checkedAt: new Date("2026-06-05"),
      createdAt: new Date("2026-06-05"),
    });
    expect(safe.rank).toBe(2);
    expect(safe.bucket).toBe("top3");
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
  });
});
