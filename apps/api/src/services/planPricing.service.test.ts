import { describe, expect, it } from "vitest";
import { normalizePricingInput, sanitizePaisa } from "./planPricing.service";

describe("sanitizePaisa", () => {
  it("keeps positive whole numbers", () => {
    expect(sanitizePaisa(1799)).toBe(1799);
  });
  it("floors fractional values", () => {
    expect(sanitizePaisa(1499.9)).toBe(1499);
  });
  it("coerces negatives, NaN, null and junk to 0", () => {
    expect(sanitizePaisa(-50)).toBe(0);
    expect(sanitizePaisa(NaN)).toBe(0);
    expect(sanitizePaisa(null)).toBe(0);
    expect(sanitizePaisa("abc")).toBe(0);
  });
  it("parses numeric strings", () => {
    expect(sanitizePaisa("2899")).toBe(2899);
  });
});

describe("normalizePricingInput", () => {
  it("trims the name and clamps every price field", () => {
    expect(
      normalizePricingInput({
        planName: "  Advance Plan  ",
        sortOrder: 2,
        monthlyPaisa: 2899,
        quarterlyPaisa: 2499,
        yearlyPaisa: 1999,
        addLocationMonthlyPaisa: -5,
        addLocationQuarterlyPaisa: 500.7,
        addLocationYearlyPaisa: 400,
      }),
    ).toEqual({
      planName: "Advance Plan",
      sortOrder: 2,
      monthlyPaisa: 2899,
      quarterlyPaisa: 2499,
      yearlyPaisa: 1999,
      addLocationMonthlyPaisa: 0,
      addLocationQuarterlyPaisa: 500,
      addLocationYearlyPaisa: 400,
    });
  });

  it("defaults missing prices and sortOrder to 0", () => {
    expect(normalizePricingInput({ planName: "Free Forever" })).toEqual({
      planName: "Free Forever",
      sortOrder: 0,
      monthlyPaisa: 0,
      quarterlyPaisa: 0,
      yearlyPaisa: 0,
      addLocationMonthlyPaisa: 0,
      addLocationQuarterlyPaisa: 0,
      addLocationYearlyPaisa: 0,
    });
  });
});
