import { describe, expect, it } from "vitest";
import {
  CustomerHealthTier,
  PlatformActionSeverity,
} from "@nexaflow/db";
import { classifyChurnRisk } from "./platformMonitor.service";

describe("classifyChurnRisk", () => {
  it("maps CHURNING to URGENT (bottom of the score band)", () => {
    const result = classifyChurnRisk(CustomerHealthTier.CHURNING);
    expect(result.severity).toBe(PlatformActionSeverity.URGENT);
  });

  it("maps AT_RISK to HIGH (recoverable but slipping)", () => {
    const result = classifyChurnRisk(CustomerHealthTier.AT_RISK);
    expect(result.severity).toBe(PlatformActionSeverity.HIGH);
  });

  it("returns null for HEALTHY", () => {
    const result = classifyChurnRisk(CustomerHealthTier.HEALTHY);
    expect(result.severity).toBeNull();
  });

  it("returns null for THRIVING", () => {
    const result = classifyChurnRisk(CustomerHealthTier.THRIVING);
    expect(result.severity).toBeNull();
  });

  it("never returns LOW or MEDIUM (only URGENT/HIGH/null are valid for this signal)", () => {
    for (const tier of Object.values(CustomerHealthTier)) {
      const result = classifyChurnRisk(tier);
      if (result.severity !== null) {
        expect([
          PlatformActionSeverity.URGENT,
          PlatformActionSeverity.HIGH,
        ]).toContain(result.severity);
      }
    }
  });
});
