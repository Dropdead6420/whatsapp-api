import { describe, expect, it } from "vitest";
import { GmbPostType } from "@nexaflow/db";
import { buildGmbCaption, toSafeGmbPost, GMB_CTA_TYPES } from "./gmb.service";

describe("buildGmbCaption", () => {
  it("offer posts mention the offer and use an ORDER CTA", () => {
    const c = buildGmbCaption({ businessName: "Acme", type: GmbPostType.OFFER, topic: "20% off" });
    expect(c.type).toBe(GmbPostType.OFFER);
    expect(c.summary).toContain("Acme");
    expect(c.summary).toContain("20% off");
    expect(c.callToActionType).toBe("ORDER");
  });

  it("event posts use a LEARN_MORE CTA", () => {
    const c = buildGmbCaption({ businessName: "Acme", type: GmbPostType.EVENT, topic: "grand opening" });
    expect(c.type).toBe(GmbPostType.EVENT);
    expect(c.summary).toContain("grand opening");
    expect(c.callToActionType).toBe("LEARN_MORE");
  });

  it("defaults to an UPDATE post", () => {
    const c = buildGmbCaption({ businessName: "Acme" });
    expect(c.type).toBe(GmbPostType.UPDATE);
    expect(c.callToActionType).toBe("LEARN_MORE");
  });

  it("adds an emoji only in playful tone", () => {
    const plain = buildGmbCaption({ businessName: "Acme", type: GmbPostType.OFFER, topic: "x" });
    const playful = buildGmbCaption({ businessName: "Acme", type: GmbPostType.OFFER, topic: "x", tone: "playful" });
    expect(plain.summary.startsWith("🎉")).toBe(false);
    expect(playful.summary.startsWith("🎉")).toBe(true);
  });

  it("every generated CTA is a valid GMB CTA type", () => {
    for (const type of [GmbPostType.UPDATE, GmbPostType.OFFER, GmbPostType.EVENT]) {
      const c = buildGmbCaption({ businessName: "Acme", type });
      expect(GMB_CTA_TYPES).toContain(c.callToActionType);
    }
  });
});

describe("toSafeGmbPost", () => {
  it("projects the row fields", () => {
    const row = {
      id: "g1",
      tenantId: "t1",
      type: GmbPostType.UPDATE,
      summary: "hello",
      mediaUrl: null,
      callToActionType: "LEARN_MORE",
      callToActionUrl: null,
      locationLabel: null,
      scheduledAt: null,
      status: "DRAFT" as const,
      publishedAt: null,
      error: null,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
    };
    const safe = toSafeGmbPost(row);
    expect(safe).toMatchObject({ id: "g1", summary: "hello", status: "DRAFT" });
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
  });
});
