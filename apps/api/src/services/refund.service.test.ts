import { describe, expect, it } from "vitest";
import { computeReversalAmount } from "./refund.service";

describe("computeReversalAmount", () => {
  it("returns the refunded amount for a normal partial refund", () => {
    expect(computeReversalAmount(10_000, 4_000)).toBe(4_000);
  });

  it("returns the full amount for a full refund", () => {
    expect(computeReversalAmount(10_000, 10_000)).toBe(10_000);
  });

  it("caps an over-refund at the order amount (defense against bad payload)", () => {
    expect(computeReversalAmount(10_000, 15_000)).toBe(10_000);
  });

  it("returns 0 (skip) for a non-positive refund", () => {
    expect(computeReversalAmount(10_000, 0)).toBe(0);
    expect(computeReversalAmount(10_000, -500)).toBe(0);
  });

  it("returns 0 when the order amount is non-positive", () => {
    expect(computeReversalAmount(0, 5_000)).toBe(0);
    expect(computeReversalAmount(-100, 5_000)).toBe(0);
  });

  it("returns 0 on non-finite inputs", () => {
    expect(computeReversalAmount(10_000, Number.NaN)).toBe(0);
    expect(computeReversalAmount(Number.POSITIVE_INFINITY, 5_000)).toBe(0);
  });

  it("truncates fractional gateway amounts to whole smallest-units", () => {
    expect(computeReversalAmount(10_000, 4_000.7)).toBe(4_000);
  });

  it("truncates a fractional order cap too", () => {
    expect(computeReversalAmount(9_999.9, 10_000)).toBe(9_999);
  });
});
