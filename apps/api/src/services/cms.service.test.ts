import { describe, expect, it } from "vitest";
import { CmsContentStatus, CmsContentType } from "@nexaflow/db";
import { isPublished, slugify, sortContent, toPublicContent } from "./cms.service";

describe("slugify", () => {
  it("lowercases and dashes non-alphanumerics, trimming edges", () => {
    expect(slugify("  Pricing & Plans! ")).toBe("pricing-plans");
    expect(slugify("Privacy Policy")).toBe("privacy-policy");
    expect(slugify("Already-good_slug")).toBe("already-good-slug");
  });
});

describe("isPublished", () => {
  it("is true only for PUBLISHED", () => {
    expect(isPublished({ status: CmsContentStatus.PUBLISHED })).toBe(true);
    expect(isPublished({ status: CmsContentStatus.DRAFT })).toBe(false);
    expect(isPublished({ status: CmsContentStatus.ARCHIVED })).toBe(false);
  });
});

describe("sortContent", () => {
  it("orders by sortOrder, then title", () => {
    const out = sortContent([
      { sortOrder: 2, title: "B" },
      { sortOrder: 1, title: "Z" },
      { sortOrder: 1, title: "A" },
    ]);
    expect(out.map((r) => r.title)).toEqual(["A", "Z", "B"]);
  });
});

describe("toPublicContent", () => {
  const row = {
    id: "c1",
    type: CmsContentType.FAQ,
    slug: "billing",
    locale: "en",
    title: "Billing FAQ",
    excerpt: "How billing works",
    body: "Long answer",
    data: { group: "billing" },
    metaTitle: null,
    metaDescription: null,
    status: CmsContentStatus.PUBLISHED,
    sortOrder: 3,
    publishedAt: new Date("2026-06-01"),
    updatedByUserId: "user_9",
    createdAt: new Date("2026-05-01"),
    updatedAt: new Date("2026-06-01"),
  };

  it("projects a public view, falling back meta→title/excerpt and hiding internals", () => {
    const pub = toPublicContent(row);
    expect(pub.metaTitle).toBe("Billing FAQ"); // falls back to title
    expect(pub.metaDescription).toBe("How billing works"); // falls back to excerpt
    expect(pub.data).toEqual({ group: "billing" });
    expect((pub as Record<string, unknown>).status).toBeUndefined();
    expect((pub as Record<string, unknown>).sortOrder).toBeUndefined();
    expect((pub as Record<string, unknown>).updatedByUserId).toBeUndefined();
    expect((pub as Record<string, unknown>).id).toBeUndefined();
  });
});
