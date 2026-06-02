import { describe, expect, it } from "vitest";
import {
  assertCanTransitionStatus,
  canTransitionStatus,
  computeUsedCredits,
  isOverUtilizationThreshold,
  sanitizeLimitCredits,
  sanitizeNotes,
} from "./creditLine.service";

describe("canTransitionStatus", () => {
  it("ACTIVE → SUSPENDED is allowed (pause for risk)", () => {
    expect(canTransitionStatus("ACTIVE", "SUSPENDED")).toBe(true);
  });

  it("ACTIVE → CLOSED is allowed (end the line)", () => {
    expect(canTransitionStatus("ACTIVE", "CLOSED")).toBe(true);
  });

  it("SUSPENDED → ACTIVE is allowed (reactivate after payment)", () => {
    expect(canTransitionStatus("SUSPENDED", "ACTIVE")).toBe(true);
  });

  it("SUSPENDED → CLOSED is allowed (give up on the line)", () => {
    expect(canTransitionStatus("SUSPENDED", "CLOSED")).toBe(true);
  });

  it("CLOSED is terminal — no further transitions", () => {
    for (const target of ["ACTIVE", "SUSPENDED"] as const) {
      expect(canTransitionStatus("CLOSED", target)).toBe(false);
    }
  });

  it("self-transitions are forbidden", () => {
    for (const s of ["ACTIVE", "SUSPENDED", "CLOSED"] as const) {
      expect(canTransitionStatus(s, s)).toBe(false);
    }
  });
});

describe("assertCanTransitionStatus", () => {
  it("throws on terminal-→-anything", () => {
    expect(() => assertCanTransitionStatus("CLOSED", "ACTIVE")).toThrow(
      /transition/i,
    );
  });

  it("does not throw on legal transitions", () => {
    expect(() => assertCanTransitionStatus("ACTIVE", "SUSPENDED")).not.toThrow();
    expect(() => assertCanTransitionStatus("SUSPENDED", "ACTIVE")).not.toThrow();
  });
});

describe("computeUsedCredits", () => {
  it("positive balance → 0 used", () => {
    expect(computeUsedCredits(1000)).toBe(0);
  });

  it("zero balance → 0 used", () => {
    expect(computeUsedCredits(0)).toBe(0);
  });

  it("negative balance → magnitude as used", () => {
    expect(computeUsedCredits(-500)).toBe(500);
  });

  it("very negative balance → magnitude", () => {
    expect(computeUsedCredits(-100_000)).toBe(100_000);
  });
});

describe("isOverUtilizationThreshold", () => {
  it("returns false below 80% default", () => {
    expect(isOverUtilizationThreshold({ used: 100, limit: 1000 })).toBe(false);
  });

  it("returns true at exactly 80%", () => {
    expect(isOverUtilizationThreshold({ used: 800, limit: 1000 })).toBe(true);
  });

  it("returns true above 80%", () => {
    expect(isOverUtilizationThreshold({ used: 950, limit: 1000 })).toBe(true);
  });

  it("respects a custom threshold", () => {
    expect(
      isOverUtilizationThreshold({ used: 500, limit: 1000, thresholdPct: 50 }),
    ).toBe(true);
    expect(
      isOverUtilizationThreshold({ used: 499, limit: 1000, thresholdPct: 50 }),
    ).toBe(false);
  });

  it("returns false on zero / negative limit (defense in depth)", () => {
    expect(isOverUtilizationThreshold({ used: 100, limit: 0 })).toBe(false);
    expect(isOverUtilizationThreshold({ used: 100, limit: -50 })).toBe(false);
  });

  it("returns false when used is zero", () => {
    expect(isOverUtilizationThreshold({ used: 0, limit: 1000 })).toBe(false);
  });
});

describe("sanitizeLimitCredits", () => {
  it("accepts a typical limit", () => {
    expect(sanitizeLimitCredits(50_000)).toBe(50_000);
  });

  it("accepts the minimum (1 credit)", () => {
    expect(sanitizeLimitCredits(1)).toBe(1);
  });

  it("rejects zero / negative", () => {
    expect(() => sanitizeLimitCredits(0)).toThrow(/at least/i);
    expect(() => sanitizeLimitCredits(-100)).toThrow(/at least/i);
  });

  it("rejects fractional credits", () => {
    expect(() => sanitizeLimitCredits(100.5)).toThrow(/integer/i);
  });

  it("rejects above ceiling", () => {
    expect(() => sanitizeLimitCredits(1_000_000_000)).toThrow(/exceed/i);
  });

  it("rejects NaN / non-numeric", () => {
    expect(() => sanitizeLimitCredits(NaN)).toThrow(/number/i);
    expect(() => sanitizeLimitCredits("not-a-number")).toThrow(/number/i);
  });

  it("parses numeric strings", () => {
    expect(sanitizeLimitCredits("10000")).toBe(10_000);
  });
});

describe("sanitizeNotes", () => {
  it("returns null for null / undefined / empty", () => {
    expect(sanitizeNotes(null)).toBeNull();
    expect(sanitizeNotes("   ")).toBeNull();
    expect(sanitizeNotes(undefined)).toBeNull();
  });

  it("trims + caps at 1024", () => {
    expect(sanitizeNotes("  Enterprise contract  ")).toBe("Enterprise contract");
    expect(sanitizeNotes("x".repeat(2000))?.length).toBe(1024);
  });

  it("returns null for non-string input (forgiving — notes are optional)", () => {
    expect(sanitizeNotes(42)).toBeNull();
  });
});
