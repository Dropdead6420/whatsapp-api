import { describe, expect, it } from "vitest";
import { generateKeywordIdeas, toSafeIdeaSet } from "./gmbKeyword.service";

describe("generateKeywordIdeas", () => {
  it("produces local-intent combinations and ranks city+service highest", () => {
    const ideas = generateKeywordIdeas({
      category: "Cafe",
      city: "Pune",
      services: ["espresso", "cold brew"],
    });
    const kws = ideas.map((i) => i.keyword);
    expect(kws).toContain("espresso in Pune");
    expect(kws).toContain("best espresso in Pune");
    expect(kws).toContain("espresso near me");
    // city+service combo outranks the bare service term
    const inCity = ideas.find((i) => i.keyword === "espresso in Pune")!;
    const bare = ideas.find((i) => i.keyword === "espresso")!;
    expect(inCity.score).toBeGreaterThan(bare.score);
    expect(ideas[0].score).toBeGreaterThanOrEqual(ideas[ideas.length - 1].score); // sorted desc
  });

  it("uses the category as the base term when no services are given", () => {
    const ideas = generateKeywordIdeas({ category: "Dentist", city: "Austin" });
    const kws = ideas.map((i) => i.keyword);
    expect(kws).toContain("Dentist in Austin");
    expect(ideas.some((i) => i.kind === "category")).toBe(true);
  });

  it("adds competitor-intent keywords", () => {
    const ideas = generateKeywordIdeas({ category: "Gym", competitors: ["FitClub"] });
    const competitor = ideas.filter((i) => i.kind === "competitor").map((i) => i.keyword);
    expect(competitor).toContain("FitClub alternative");
  });

  it("de-duplicates case-insensitively and respects the limit", () => {
    const ideas = generateKeywordIdeas({
      services: ["Plumbing", "plumbing"], // same term, different case
      city: "Reno",
      limit: 3,
    });
    expect(ideas.length).toBe(3);
    const lower = ideas.map((i) => i.keyword.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length); // no dupes
  });

  it("returns nothing when there is no category or service to seed from", () => {
    expect(generateKeywordIdeas({ city: "Pune" })).toEqual([]);
  });
});

describe("toSafeIdeaSet", () => {
  it("exposes inputs + ideas with a count, hides tenantId", () => {
    const ideas = [{ keyword: "cafe in pune", kind: "city", score: 90 }];
    const safe = toSafeIdeaSet({
      id: "k1",
      tenantId: "t1",
      locationId: "loc1",
      category: "Cafe",
      city: "Pune",
      region: null,
      services: ["espresso"],
      competitors: [],
      ideas,
      createdAt: new Date("2026-06-01"),
    });
    expect(safe.count).toBe(1);
    expect(safe.ideas).toEqual(ideas);
    expect(safe.services).toEqual(["espresso"]);
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
  });
});
