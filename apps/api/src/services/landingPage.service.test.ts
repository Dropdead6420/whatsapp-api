import { describe, expect, it } from "vitest";
import { ApiError } from "@nexaflow/shared";
import {
  normalizeBlocks,
  slugify,
  toSafeLandingPage,
} from "./landingPage.service";

describe("slugify", () => {
  it("lowercases and dashes non-alphanumerics", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
    expect(slugify("  Acme Co. -- 2026  ")).toBe("acme-co-2026");
  });
  it("trims leading/trailing dashes and caps length", () => {
    expect(slugify("--Promo--")).toBe("promo");
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
  it("throws when nothing usable remains", () => {
    expect(() => slugify("***")).toThrow(ApiError);
    expect(() => slugify("   ")).toThrow(ApiError);
  });
});

describe("normalizeBlocks", () => {
  it("treats null/undefined as an empty page", () => {
    expect(normalizeBlocks(null)).toEqual([]);
    expect(normalizeBlocks(undefined)).toEqual([]);
  });
  it("coerces valid blocks and defaults props to {}", () => {
    expect(
      normalizeBlocks([
        { type: "hero", props: { title: "Hi" } },
        { type: "cta" },
      ]),
    ).toEqual([
      { type: "hero", props: { title: "Hi" } },
      { type: "cta", props: {} },
    ]);
  });
  it("rejects non-arrays", () => {
    expect(() => normalizeBlocks({ type: "hero" })).toThrow(ApiError);
  });
  it("rejects unknown block types", () => {
    expect(() => normalizeBlocks([{ type: "danger" }])).toThrow(/unsupported type/i);
  });
  it("rejects non-object entries", () => {
    expect(() => normalizeBlocks(["hero"])).toThrow(ApiError);
  });
  it("rejects oversized arrays", () => {
    const many = Array.from({ length: 101 }, () => ({ type: "text" }));
    expect(() => normalizeBlocks(many)).toThrow(/max 100/i);
  });
});

describe("toSafeLandingPage", () => {
  const base = {
    id: "p1",
    tenantId: "t1",
    slug: "home",
    title: "Home",
    blocks: [{ type: "hero", props: {} }],
    theme: { color: "emerald" },
    seoTitle: null,
    seoDescription: null,
    status: "DRAFT" as const,
    publishedAt: null,
    archivedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
  };
  it("passes through a block array", () => {
    expect(toSafeLandingPage(base).blocks).toEqual([{ type: "hero", props: {} }]);
  });
  it("defaults null blocks to []", () => {
    expect(toSafeLandingPage({ ...base, blocks: null }).blocks).toEqual([]);
    expect(toSafeLandingPage({ ...base, theme: null }).theme).toBeNull();
  });
});
