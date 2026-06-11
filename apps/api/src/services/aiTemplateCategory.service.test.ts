import { describe, expect, it } from "vitest";
import { slugifyCategoryKey, summarizeCategories } from "./aiTemplateCategory.service";

describe("summarizeCategories", () => {
  it("counts total / enabled / disabled", () => {
    expect(summarizeCategories([{ enabled: true }, { enabled: true }, { enabled: false }])).toEqual({
      total: 3,
      enabled: 2,
      disabled: 1,
    });
  });
  it("is all-zero for no categories", () => {
    expect(summarizeCategories([])).toEqual({ total: 0, enabled: 0, disabled: 0 });
  });
});

describe("slugifyCategoryKey", () => {
  it("lowercases and kebab-cases", () => {
    expect(slugifyCategoryKey("Marketing Agencies")).toBe("marketing-agencies");
    expect(slugifyCategoryKey("  CTA Prompts  ")).toBe("cta-prompts");
  });
  it("collapses non-alphanumerics and trims stray dashes", () => {
    expect(slugifyCategoryKey("Company / Related!!")).toBe("company-related");
    expect(slugifyCategoryKey("--Fun & Games--")).toBe("fun-games");
  });
});
