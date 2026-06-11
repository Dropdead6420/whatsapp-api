import { describe, expect, it } from "vitest";
import {
  GMB_PROMPT_KEYS,
  postCaptionVariables,
  renderWithFallback,
  reviewReplyVariables,
} from "./gmbAiPrompts.service";

describe("GMB_PROMPT_KEYS", () => {
  it("defines a stable key per AI feature", () => {
    expect(GMB_PROMPT_KEYS.reviewReply).toBe("gmb.review_reply");
    expect(GMB_PROMPT_KEYS.description).toBe("gmb.description_optimizer");
    expect(Object.keys(GMB_PROMPT_KEYS)).toHaveLength(7);
  });
});

describe("reviewReplyVariables", () => {
  it("uses the author's first name and passes rating/comment", () => {
    expect(
      reviewReplyVariables({ authorName: "Priya Sharma", rating: 5, businessName: "Acme Cafe", comment: "Loved it" }),
    ).toEqual({ author: "Priya", rating: 5, business: "Acme Cafe", comment: "Loved it" });
  });

  it("falls back to safe defaults when author/business are missing", () => {
    const v = reviewReplyVariables({ rating: 2, businessName: "  " });
    expect(v.author).toBe("there");
    expect(v.business).toBe("our team");
    expect(v.comment).toBe("");
  });
});

describe("postCaptionVariables", () => {
  it("defaults tone to friendly and trims topic", () => {
    expect(postCaptionVariables({ businessName: "Acme", topic: " Diwali sale " })).toEqual({
      business: "Acme",
      topic: "Diwali sale",
      tone: "friendly",
    });
  });
});

describe("renderWithFallback", () => {
  const vars = { author: "Sam", business: "Acme", rating: 5, comment: "great" };

  it("renders an active template and reports missing placeholders", () => {
    const r = renderWithFallback(
      { template: "Hi {{author}} — thanks from {{business}}! Ref {{ticket}}", isActive: true },
      vars,
      "FALLBACK",
    );
    expect(r.source).toBe("template");
    expect(r.text).toBe("Hi Sam — thanks from Acme! Ref {{ticket}}");
    expect(r.missing).toEqual(["ticket"]);
  });

  it("uses the deterministic fallback when no template is configured", () => {
    expect(renderWithFallback(null, vars, "FALLBACK")).toEqual({ text: "FALLBACK", source: "fallback", missing: [] });
  });

  it("uses the fallback when the template is inactive or empty", () => {
    expect(renderWithFallback({ template: "x", isActive: false }, vars, "FB").source).toBe("fallback");
    expect(renderWithFallback({ template: "   ", isActive: true }, vars, "FB").source).toBe("fallback");
  });
});
