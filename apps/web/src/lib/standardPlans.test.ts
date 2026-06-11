import { describe, expect, it } from "vitest";
import { standardPlanRows } from "./standardPlans";

describe("standardPlanRows", () => {
  it("offers the three standard tiers in order", () => {
    expect(standardPlanRows().map((r) => r.planName)).toEqual(["Free Forever", "Starter Plan", "Advance Plan"]);
  });

  it("prices descend per longer cycle (monthly >= quarterly >= yearly) for paid plans", () => {
    for (const r of standardPlanRows()) {
      const [m, q, y] = [Number(r.monthly), Number(r.quarterly), Number(r.yearly)];
      expect(m).toBeGreaterThanOrEqual(q);
      expect(q).toBeGreaterThanOrEqual(y);
    }
  });

  it("only the Advance tier carries add-location pricing", () => {
    const advance = standardPlanRows().find((r) => r.planName === "Advance Plan")!;
    expect(advance.addMonthly).not.toBe("");
    const starter = standardPlanRows().find((r) => r.planName === "Starter Plan")!;
    expect(starter.addMonthly).toBe("");
  });
});
