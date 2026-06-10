import { describe, expect, it } from "vitest";
import {
  buildCostMap,
  estimateCost,
  normalizeActionKey,
  resolveCost,
  toSafeRule,
} from "./creditRule.service";

const rules = [
  { action: "ai.review_reply", cost: 2, isActive: true },
  { action: "ai.image", cost: 10, isActive: true },
  { action: "ai.report", cost: 5, isActive: false }, // inactive
];

describe("normalizeActionKey", () => {
  it("lowercases, trims and underscores spaces", () => {
    expect(normalizeActionKey("  AI Review Reply ")).toBe("ai_review_reply");
    expect(normalizeActionKey("ai.image")).toBe("ai.image");
  });
});

describe("resolveCost", () => {
  it("returns the cost for an active rule", () => {
    expect(resolveCost(rules, "ai.review_reply")).toBe(2);
    expect(resolveCost(rules, "AI.IMAGE")).toBe(10); // case-insensitive
  });
  it("returns null for unknown or inactive actions", () => {
    expect(resolveCost(rules, "ai.report")).toBeNull(); // inactive
    expect(resolveCost(rules, "nope")).toBeNull();
  });
});

describe("buildCostMap", () => {
  it("includes only active rules", () => {
    expect(buildCostMap(rules)).toEqual({ "ai.review_reply": 2, "ai.image": 10 });
  });
});

describe("estimateCost", () => {
  it("totals known actions by quantity and lists unknown ones", () => {
    const e = estimateCost(rules, [
      { action: "ai.review_reply", qty: 3 },
      { action: "ai.image" }, // qty defaults to 1
      { action: "ai.report" }, // inactive → unknown
      { action: "mystery" },
    ]);
    expect(e.total).toBe(3 * 2 + 10); // 16
    expect(e.lines).toHaveLength(2);
    expect(e.unknown).toEqual(["ai.report", "mystery"]);
  });
});

describe("toSafeRule", () => {
  it("exposes rule fields but hides updatedByUserId", () => {
    const safe = toSafeRule({
      id: "r1",
      action: "ai.image",
      label: "AI image generation",
      description: null,
      cost: 10,
      isActive: true,
      updatedByUserId: "user_1",
      createdAt: new Date("2026-06-01"),
      updatedAt: new Date("2026-06-01"),
    });
    expect(safe.action).toBe("ai.image");
    expect(safe.cost).toBe(10);
    expect((safe as Record<string, unknown>).updatedByUserId).toBeUndefined();
  });
});
