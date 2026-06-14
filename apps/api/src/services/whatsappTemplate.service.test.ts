import { describe, expect, it } from "vitest";
import {
  normalizeTemplateCategory,
  normalizeHeaderType,
  validateTemplateButtons,
} from "./whatsappTemplate.service";

describe("normalizeTemplateCategory", () => {
  it("accepts the three Meta buckets case-insensitively, defaults to MARKETING", () => {
    expect(normalizeTemplateCategory("utility")).toBe("UTILITY");
    expect(normalizeTemplateCategory("AUTHENTICATION")).toBe("AUTHENTICATION");
    expect(normalizeTemplateCategory("nonsense")).toBe("MARKETING");
    expect(normalizeTemplateCategory(undefined)).toBe("MARKETING");
  });
});

describe("normalizeHeaderType", () => {
  it("maps known types and defaults unknown to NONE", () => {
    expect(normalizeHeaderType("image")).toBe("IMAGE");
    expect(normalizeHeaderType("")).toBe("NONE");
    expect(normalizeHeaderType("banner")).toBe("NONE");
  });
});

describe("validateTemplateButtons", () => {
  it("returns [] for null/empty", () => {
    expect(validateTemplateButtons(null)).toEqual([]);
    expect(validateTemplateButtons([])).toEqual([]);
  });

  it("cleans a valid mixed set", () => {
    const out = validateTemplateButtons([
      { type: "url", text: "Shop now", url: "https://example.com/x" },
      { type: "PHONE_NUMBER", text: "Call us", phoneNumber: "+919812345678" },
      { type: "COPY_CODE", text: "Copy", offerCode: "HEALTH10" },
      { type: "QUICK_REPLY", text: "Stop" },
    ]);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ type: "URL", text: "Shop now", url: "https://example.com/x" });
    expect(out[1].phoneNumber).toBe("+919812345678");
  });

  it("rejects > 10 buttons", () => {
    const many = Array.from({ length: 11 }, () => ({ type: "QUICK_REPLY", text: "Hi" }));
    expect(() => validateTemplateButtons(many)).toThrow(/at most 10/i);
  });

  it("rejects bad URL / phone / missing text / long label / extra phone", () => {
    expect(() => validateTemplateButtons([{ type: "URL", text: "x", url: "not-a-url" }])).toThrow(/valid http/i);
    expect(() => validateTemplateButtons([{ type: "PHONE_NUMBER", text: "x", phoneNumber: "abc" }])).toThrow(/E\.164|valid number/i);
    expect(() => validateTemplateButtons([{ type: "QUICK_REPLY", text: "" }])).toThrow(/label/i);
    expect(() => validateTemplateButtons([{ type: "QUICK_REPLY", text: "x".repeat(26) }])).toThrow(/25 characters/i);
    expect(() =>
      validateTemplateButtons([
        { type: "PHONE_NUMBER", text: "a", phoneNumber: "+911111111" },
        { type: "PHONE_NUMBER", text: "b", phoneNumber: "+922222222" },
      ]),
    ).toThrow(/1 phone/i);
  });
});
