import { describe, expect, it } from "vitest";
import {
  normalizeTemplateCategory,
  normalizeHeaderType,
  normalizeTemplateType,
  normalizeCatalogFormat,
  validateTemplateButtons,
  validateCarousel,
  mapMetaTemplate,
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

  it("accepts the marketing sub-type buttons (catalog / order details) as text-only", () => {
    const out = validateTemplateButtons([
      { type: "CATALOG", text: "View catalog" },
      { type: "ORDER_DETAILS", text: "Review and Pay" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ type: "CATALOG", text: "View catalog" });
    expect(out[1]).toEqual({ type: "ORDER_DETAILS", text: "Review and Pay" });
  });

  it("allows at most 1 of each singleton button (catalog/mpm/order details)", () => {
    expect(() =>
      validateTemplateButtons([
        { type: "CATALOG", text: "View catalog" },
        { type: "CATALOG", text: "Browse" },
      ]),
    ).toThrow(/1 catalog/i);
  });

  it("accepts an OTP button with otpType, defaulting unknown to COPY_CODE, ≤1 allowed", () => {
    const out = validateTemplateButtons([{ type: "OTP", text: "Copy code", otpType: "one_tap" }]);
    expect(out[0]).toEqual({ type: "OTP", text: "Copy code", otpType: "ONE_TAP" });
    expect(validateTemplateButtons([{ type: "OTP", text: "Autofill", otpType: "bogus" }])[0].otpType).toBe("COPY_CODE");
    expect(() =>
      validateTemplateButtons([
        { type: "OTP", text: "Copy code", otpType: "COPY_CODE" },
        { type: "OTP", text: "Autofill", otpType: "ONE_TAP" },
      ]),
    ).toThrow(/1 otp/i);
  });
});

describe("normalizeTemplateType", () => {
  it("accepts known sub-types case-insensitively, defaults to CUSTOM", () => {
    expect(normalizeTemplateType("carousel")).toBe("CAROUSEL");
    expect(normalizeTemplateType("ORDER_DETAILS")).toBe("ORDER_DETAILS");
    expect(normalizeTemplateType("nope")).toBe("CUSTOM");
    expect(normalizeTemplateType(undefined)).toBe("CUSTOM");
  });
});

describe("normalizeCatalogFormat", () => {
  it("accepts the two catalogue formats, defaults to CATALOG_MESSAGE", () => {
    expect(normalizeCatalogFormat("mpm")).toBe("MPM");
    expect(normalizeCatalogFormat("CATALOG_MESSAGE")).toBe("CATALOG_MESSAGE");
    expect(normalizeCatalogFormat("other")).toBe("CATALOG_MESSAGE");
  });
});

describe("validateCarousel", () => {
  it("returns [] for null/empty", () => {
    expect(validateCarousel(null)).toEqual([]);
    expect(validateCarousel([])).toEqual([]);
  });

  it("cleans valid cards with header, body and nested buttons", () => {
    const out = validateCarousel([
      {
        headerType: "image",
        headerMediaUrl: "https://example.com/a.jpg",
        bodyText: "Card one",
        buttons: [{ type: "URL", text: "Buy", url: "https://example.com/buy" }],
      },
      { headerType: "none", bodyText: "Card two", buttons: [] },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].headerType).toBe("IMAGE");
    expect(out[0].headerMediaUrl).toBe("https://example.com/a.jpg");
    expect(out[0].buttons[0].type).toBe("URL");
    expect(out[1].headerType).toBe("NONE");
  });

  it("rejects > 10 cards, empty body, over-long body and bad media URL", () => {
    const many = Array.from({ length: 11 }, () => ({ bodyText: "x" }));
    expect(() => validateCarousel(many)).toThrow(/at most 10 cards/i);
    expect(() => validateCarousel([{ bodyText: "" }])).toThrow(/needs body text/i);
    expect(() => validateCarousel([{ bodyText: "x".repeat(161) }])).toThrow(/160 characters/i);
    expect(() =>
      validateCarousel([{ headerType: "image", headerMediaUrl: "nope", bodyText: "ok" }]),
    ).toThrow(/valid http/i);
  });
});

describe("mapMetaTemplate", () => {
  it("maps a Meta marketing template (header/body/footer/buttons) to our shape", () => {
    const out = mapMetaTemplate({
      name: "ramadan_sale",
      language: "en_US",
      category: "MARKETING",
      status: "APPROVED",
      components: [
        { type: "HEADER", format: "TEXT", text: "Big news {{1}}" },
        { type: "BODY", text: "Hi {{1}}, 20% off this week." },
        { type: "FOOTER", text: "Reply STOP to opt out" },
        {
          type: "BUTTONS",
          buttons: [
            { type: "QUICK_REPLY", text: "Stop" },
            { type: "URL", text: "Shop", url: "https://x.com" },
            { type: "PHONE_NUMBER", text: "Call", phone_number: "+15551234567" },
          ],
        },
      ],
    });
    expect(out.name).toBe("ramadan_sale");
    expect(out.status).toBe("APPROVED");
    expect(out.category).toBe("MARKETING");
    expect(out.headerType).toBe("TEXT");
    expect(out.headerText).toBe("Big news {{1}}");
    expect(out.bodyText).toBe("Hi {{1}}, 20% off this week.");
    expect(out.footerText).toBe("Reply STOP to opt out");
    expect(out.buttons).toHaveLength(3);
    expect(out.buttons[1]).toEqual({ type: "URL", text: "Shop", url: "https://x.com" });
    expect(out.buttons[2].phoneNumber).toBe("+15551234567");
  });

  it("infers OTP type for authentication and maps PENDING → SUBMITTED", () => {
    const out = mapMetaTemplate({
      name: "otp_login",
      language: "en",
      category: "AUTHENTICATION",
      status: "PENDING",
      components: [
        { type: "BODY", text: "{{1}} is your verification code." },
        { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy code" }] },
      ],
    });
    expect(out.templateType).toBe("OTP");
    expect(out.status).toBe("SUBMITTED");
    expect(out.buttons[0]).toEqual({ type: "OTP", text: "Copy code", otpType: "COPY_CODE" });
  });

  it("infers CAROUSEL when a carousel component is present and defaults missing fields", () => {
    const out = mapMetaTemplate({
      name: "spring",
      category: "marketing",
      components: [{ type: "BODY", text: "Browse" }, { type: "CAROUSEL", cards: [] }],
    });
    expect(out.templateType).toBe("CAROUSEL");
    expect(out.language).toBe("en_US");
    expect(out.status).toBe("DRAFT");
  });
});
