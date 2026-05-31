import { describe, expect, it } from "vitest";
import { PlatformActionSeverity } from "@nexaflow/db";
import { classifyAiUsageSpike } from "./platformMonitor.service";

describe("classifyAiUsageSpike", () => {
  it("returns null below the $5 floor regardless of multiplier", () => {
    // Tenant baseline is tiny ($0.10/day), 24h spend is 30x — but only $3, below floor.
    const result = classifyAiUsageSpike({
      spend24hCents: 300,
      sevenDayAvgCents: 10,
    });
    expect(result.severity).toBeNull();
    expect(result.multiplier).toBe(0);
  });

  it("returns null when there is no 7-day baseline (new tenant)", () => {
    const result = classifyAiUsageSpike({
      spend24hCents: 10_000,
      sevenDayAvgCents: 0,
    });
    expect(result.severity).toBeNull();
  });

  it("returns null when 7-day average is negative (defensive)", () => {
    const result = classifyAiUsageSpike({
      spend24hCents: 10_000,
      sevenDayAvgCents: -100,
    });
    expect(result.severity).toBeNull();
  });

  it("returns null when 24h spend is below 3x baseline (above floor)", () => {
    // $10 today, $5/day baseline = 2x. Above floor but below HIGH tier.
    const result = classifyAiUsageSpike({
      spend24hCents: 1_000,
      sevenDayAvgCents: 500,
    });
    expect(result.severity).toBeNull();
    expect(result.multiplier).toBeCloseTo(2, 5);
  });

  it("returns HIGH at exactly 3x baseline", () => {
    const result = classifyAiUsageSpike({
      spend24hCents: 1_500,
      sevenDayAvgCents: 500,
    });
    expect(result.severity).toBe(PlatformActionSeverity.HIGH);
    expect(result.multiplier).toBeCloseTo(3, 5);
  });

  it("returns HIGH between 3x and 5x", () => {
    const result = classifyAiUsageSpike({
      spend24hCents: 2_000,
      sevenDayAvgCents: 500,
    });
    expect(result.severity).toBe(PlatformActionSeverity.HIGH);
    expect(result.multiplier).toBeCloseTo(4, 5);
  });

  it("returns URGENT at exactly 5x baseline", () => {
    const result = classifyAiUsageSpike({
      spend24hCents: 2_500,
      sevenDayAvgCents: 500,
    });
    expect(result.severity).toBe(PlatformActionSeverity.URGENT);
    expect(result.multiplier).toBeCloseTo(5, 5);
  });

  it("returns URGENT well above 5x baseline", () => {
    const result = classifyAiUsageSpike({
      spend24hCents: 50_000,
      sevenDayAvgCents: 500,
    });
    expect(result.severity).toBe(PlatformActionSeverity.URGENT);
    expect(result.multiplier).toBe(100);
  });

  it("respects the floor even at huge multipliers", () => {
    // 50x baseline, but spend24h is $0.50 — still below floor.
    const result = classifyAiUsageSpike({
      spend24hCents: 50,
      sevenDayAvgCents: 1,
    });
    expect(result.severity).toBeNull();
    expect(result.multiplier).toBe(0);
  });

  it("never escalates on a flat spend pattern (1x)", () => {
    const result = classifyAiUsageSpike({
      spend24hCents: 1_000,
      sevenDayAvgCents: 1_000,
    });
    expect(result.severity).toBeNull();
  });

  it("escalates a quiet tenant suddenly burning $50/day", () => {
    // $50/day vs $5/day baseline = 10x — clearly URGENT.
    const result = classifyAiUsageSpike({
      spend24hCents: 5_000,
      sevenDayAvgCents: 500,
    });
    expect(result.severity).toBe(PlatformActionSeverity.URGENT);
  });
});
