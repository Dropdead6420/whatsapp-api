import { describe, expect, it } from "vitest";
import {
  resolveIndustryPack,
  getIndustryPack,
} from "./customerProvisioning.service";

describe("resolveIndustryPack", () => {
  it("falls back to 'generic' on null / undefined / empty input", () => {
    expect(resolveIndustryPack(null)).toBe("generic");
    expect(resolveIndustryPack(undefined)).toBe("generic");
    expect(resolveIndustryPack("")).toBe("generic");
    expect(resolveIndustryPack("   ")).toBe("generic");
  });

  it("returns the exact pack key when the input matches", () => {
    expect(resolveIndustryPack("salon")).toBe("salon");
    expect(resolveIndustryPack("clinic")).toBe("clinic");
    expect(resolveIndustryPack("realestate")).toBe("realestate");
    expect(resolveIndustryPack("ecommerce")).toBe("ecommerce");
    expect(resolveIndustryPack("coaching")).toBe("coaching");
    expect(resolveIndustryPack("generic")).toBe("generic");
  });

  it("normalizes whitespace + case + separators", () => {
    expect(resolveIndustryPack("  Salon  ")).toBe("salon");
    expect(resolveIndustryPack("real estate")).toBe("realestate");
    expect(resolveIndustryPack("Real-Estate")).toBe("realestate");
    expect(resolveIndustryPack("real_estate")).toBe("realestate");
    expect(resolveIndustryPack("E-Commerce")).toBe("ecommerce");
  });

  it("maps common aliases to the right pack", () => {
    expect(resolveIndustryPack("spa")).toBe("salon");
    expect(resolveIndustryPack("beauty")).toBe("salon");
    expect(resolveIndustryPack("barbershop")).toBe("salon");
    expect(resolveIndustryPack("healthcare")).toBe("clinic");
    expect(resolveIndustryPack("dental")).toBe("clinic");
    expect(resolveIndustryPack("doctor")).toBe("clinic");
    expect(resolveIndustryPack("property")).toBe("realestate");
    expect(resolveIndustryPack("realtor")).toBe("realestate");
    expect(resolveIndustryPack("shop")).toBe("ecommerce");
    expect(resolveIndustryPack("retail")).toBe("ecommerce");
    expect(resolveIndustryPack("fitness")).toBe("coaching");
    expect(resolveIndustryPack("tutor")).toBe("coaching");
  });

  it("falls back to 'generic' on unknown industries", () => {
    expect(resolveIndustryPack("blockchain")).toBe("generic");
    expect(resolveIndustryPack("xyz")).toBe("generic");
    expect(resolveIndustryPack("manufacturing")).toBe("generic");
  });
});

describe("getIndustryPack", () => {
  const industries = [
    "salon",
    "clinic",
    "realestate",
    "ecommerce",
    "coaching",
    "generic",
  ] as const;

  it("returns a non-empty pack for every known industry", () => {
    for (const industry of industries) {
      const pack = getIndustryPack(industry);
      expect(pack.campaignName).toBeTruthy();
      expect(pack.templates.length).toBeGreaterThan(0);
      expect(pack.chatbot.name).toBeTruthy();
      expect(pack.chatbot.triggerKeywords.length).toBeGreaterThan(0);
    }
  });

  it("first template is the welcome template (used for the seeded campaign)", () => {
    for (const industry of industries) {
      const pack = getIndustryPack(industry);
      expect(pack.templates[0].name).toMatch(/welcome/i);
    }
  });

  it("every template body uses {{n}} placeholders (Meta-compatible)", () => {
    for (const industry of industries) {
      const pack = getIndustryPack(industry);
      for (const t of pack.templates) {
        // At minimum the welcome template substitutes the contact's name.
        expect(t.bodyText).toMatch(/\{\{\d+\}\}/);
      }
    }
  });

  it("template names are snake_case (Meta requires no uppercase/spaces)", () => {
    for (const industry of industries) {
      const pack = getIndustryPack(industry);
      for (const t of pack.templates) {
        expect(t.name).toMatch(/^[a-z0-9_]+$/);
      }
    }
  });

  it("chatbot flow nodes are valid JSON", () => {
    for (const industry of industries) {
      const pack = getIndustryPack(industry);
      const parsed = JSON.parse(pack.chatbot.nodesJson);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("each industry pack is distinct (no shared copy)", () => {
    // Catches a refactor that accidentally aliases packs.
    const welcomeBodies = industries.map(
      (industry) => getIndustryPack(industry).templates[0].bodyText,
    );
    const uniqueBodies = new Set(welcomeBodies);
    expect(uniqueBodies.size).toBe(industries.length);
  });
});
