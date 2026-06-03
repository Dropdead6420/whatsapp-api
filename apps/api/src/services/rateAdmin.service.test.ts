import { describe, expect, it } from "vitest";
import {
  assertRateBps,
  normalizeRateInput,
  serializeRate,
  windowsOverlap,
  type RateCreateInput,
} from "./rateAdmin.service";

const baseInput: RateCreateInput = {
  countryCode: "in",
  category: "MARKETING",
  providerKey: "META",
  baseCostMicros: 880_000,
};

describe("assertRateBps", () => {
  it("accepts 0 and the max", () => {
    expect(assertRateBps(0, "taxBps")).toBe(0);
    expect(assertRateBps(100_000, "taxBps")).toBe(100_000);
  });
  it("rejects negatives, overflow, and non-integers", () => {
    expect(() => assertRateBps(-1, "taxBps")).toThrow(/between 0 and 100000/);
    expect(() => assertRateBps(100_001, "taxBps")).toThrow(/between 0 and 100000/);
    expect(() => assertRateBps(1.5, "taxBps")).toThrow(/between 0 and 100000/);
  });
});

describe("windowsOverlap", () => {
  const t = (iso: string) => new Date(iso);
  it("detects overlapping open-ended windows", () => {
    expect(
      windowsOverlap(t("2026-01-01"), null, t("2026-02-01"), null),
    ).toBe(true);
  });
  it("treats touching boundaries as non-overlapping (half-open)", () => {
    // a = [Jan, Feb), b = [Feb, null) → share only the Feb instant edge
    expect(
      windowsOverlap(t("2026-01-01"), t("2026-02-01"), t("2026-02-01"), null),
    ).toBe(false);
  });
  it("detects partial overlap", () => {
    expect(
      windowsOverlap(t("2026-01-01"), t("2026-03-01"), t("2026-02-01"), t("2026-04-01")),
    ).toBe(true);
  });
  it("returns false for fully disjoint windows", () => {
    expect(
      windowsOverlap(t("2026-01-01"), t("2026-02-01"), t("2026-03-01"), t("2026-04-01")),
    ).toBe(false);
  });
  it("an open-ended existing row overlaps any later row", () => {
    expect(
      windowsOverlap(t("2026-06-01"), t("2026-07-01"), t("2026-01-01"), null),
    ).toBe(true);
  });
});

describe("normalizeRateInput", () => {
  it("normalizes country + currency and defaults", () => {
    const out = normalizeRateInput(baseInput);
    expect(out.countryCode).toBe("IN");
    expect(out.currency).toBe("INR");
    expect(out.baseCostMicros).toBe(880_000n);
    expect(out.providerCostMicros).toBe(0n);
    expect(out.taxBps).toBe(0);
    expect(out.gatewayFeeBps).toBe(0);
    expect(out.isActive).toBe(true);
    expect(out.effectiveTo).toBeNull();
    expect(out.effectiveFrom).toBeInstanceOf(Date);
  });

  it("accepts the DEFAULT country sentinel", () => {
    expect(normalizeRateInput({ ...baseInput, countryCode: "default" }).countryCode).toBe(
      "DEFAULT",
    );
  });

  it("coerces micros from string and number", () => {
    const out = normalizeRateInput({
      ...baseInput,
      baseCostMicros: "1500000",
      providerCostMicros: 250_000,
    });
    expect(out.baseCostMicros).toBe(1_500_000n);
    expect(out.providerCostMicros).toBe(250_000n);
  });

  it("rejects a bad country code", () => {
    expect(() => normalizeRateInput({ ...baseInput, countryCode: "india" })).toThrow(
      /2-letter ISO/,
    );
  });

  it("rejects a bad currency", () => {
    expect(() => normalizeRateInput({ ...baseInput, currency: "rupees" })).toThrow(
      /3-letter ISO/,
    );
  });

  it("rejects negative cost", () => {
    expect(() => normalizeRateInput({ ...baseInput, baseCostMicros: -1 })).toThrow(
      /cannot be negative/,
    );
  });

  it("rejects effectiveTo on or before effectiveFrom", () => {
    expect(() =>
      normalizeRateInput({
        ...baseInput,
        effectiveFrom: "2026-02-01T00:00:00Z",
        effectiveTo: "2026-01-01T00:00:00Z",
      }),
    ).toThrow(/effectiveTo must be after effectiveFrom/);
  });

  it("rejects an out-of-range bps", () => {
    expect(() => normalizeRateInput({ ...baseInput, taxBps: 200_000 })).toThrow(
      /between 0 and 100000/,
    );
  });

  it("rejects an invalid date", () => {
    expect(() =>
      normalizeRateInput({ ...baseInput, effectiveFrom: "not-a-date" }),
    ).toThrow(/not a valid date/);
  });
});

describe("serializeRate", () => {
  it("renders BigInt micros as strings", () => {
    const serialized = serializeRate({
      id: "r1",
      baseCostMicros: 880_000n,
      providerCostMicros: 120_000n,
      countryCode: "IN",
    });
    expect(serialized.baseCostMicros).toBe("880000");
    expect(serialized.providerCostMicros).toBe("120000");
    expect(serialized.countryCode).toBe("IN");
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });
});
