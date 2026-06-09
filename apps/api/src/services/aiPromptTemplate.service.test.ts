import { describe, expect, it } from "vitest";
import {
  diffVariables,
  extractPlaceholders,
  renderPrompt,
  toSafeTemplate,
} from "./aiPromptTemplate.service";

describe("extractPlaceholders", () => {
  it("returns unique placeholder names in first-seen order, tolerating spaces", () => {
    const tmpl = "Hi {{ name }}, thanks for visiting {{business}}. — {{name}}";
    expect(extractPlaceholders(tmpl)).toEqual(["name", "business"]);
  });
  it("returns an empty array when there are no placeholders", () => {
    expect(extractPlaceholders("plain text")).toEqual([]);
  });
});

describe("renderPrompt", () => {
  it("fills provided values and coerces numbers", () => {
    const { text, missing } = renderPrompt("Reply to {{author}} ({{rating}}★)", {
      author: "Priya",
      rating: 5,
    });
    expect(text).toBe("Reply to Priya (5★)");
    expect(missing).toEqual([]);
  });

  it("leaves unknown/blank placeholders intact and reports them as missing", () => {
    const { text, missing } = renderPrompt("Hi {{name}} at {{business}}", { name: "" });
    expect(text).toBe("Hi {{name}} at {{business}}");
    expect(missing).toEqual(["name", "business"]);
  });
});

describe("diffVariables", () => {
  it("reports undeclared placeholders and unused declarations", () => {
    const d = diffVariables("Hi {{name}} from {{business}}", ["name", "phone"]);
    expect(d.placeholders).toEqual(["name", "business"]);
    expect(d.undeclared).toEqual(["business"]); // in template, not declared
    expect(d.unused).toEqual(["phone"]); // declared, not in template
  });
});

describe("toSafeTemplate", () => {
  it("exposes template fields but omits updatedByUserId", () => {
    const safe = toSafeTemplate({
      id: "p1",
      key: "gmb.review_reply",
      name: "GMB review reply",
      description: null,
      category: "GMB",
      template: "Hi {{author}}",
      variables: ["author"],
      model: "gpt-4o-mini",
      isActive: true,
      version: 3,
      updatedByUserId: "user_123",
      createdAt: new Date("2026-06-01"),
      updatedAt: new Date("2026-06-02"),
    });
    expect(safe.key).toBe("gmb.review_reply");
    expect(safe.version).toBe(3);
    expect(safe.variables).toEqual(["author"]);
    expect((safe as Record<string, unknown>).updatedByUserId).toBeUndefined();
  });
});
