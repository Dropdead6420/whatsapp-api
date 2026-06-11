import { describe, expect, it } from "vitest";
import { GmbReviewStatus } from "@nexaflow/db";
import {
  buildReviewReplyDraft,
  ratingSentiment,
  summarizeReviews,
  toSafeReview,
} from "./gmbReview.service";

const row = {
  id: "rev1",
  tenantId: "t1",
  locationId: "loc1",
  externalReviewId: "g-abc",
  authorName: "Priya Sharma",
  rating: 5,
  comment: "Great coffee",
  reviewedAt: new Date("2026-06-01"),
  status: GmbReviewStatus.NEW,
  replyText: null,
  repliedAt: null,
  createdAt: new Date("2026-06-02"),
  updatedAt: new Date("2026-06-02"),
};

describe("toSafeReview", () => {
  it("exposes the review fields but hides tenantId and externalReviewId", () => {
    const safe = toSafeReview(row);
    expect(safe.id).toBe("rev1");
    expect(safe.locationId).toBe("loc1");
    expect(safe.rating).toBe(5);
    expect(safe.isGoogleSynced).toBe(true);
    expect((safe as Record<string, unknown>).tenantId).toBeUndefined();
    expect((safe as Record<string, unknown>).externalReviewId).toBeUndefined();
  });
});

describe("ratingSentiment", () => {
  it("maps rating bands to sentiment", () => {
    expect(ratingSentiment(5)).toBe("positive");
    expect(ratingSentiment(4)).toBe("positive");
    expect(ratingSentiment(3)).toBe("neutral");
    expect(ratingSentiment(2)).toBe("negative");
    expect(ratingSentiment(1)).toBe("negative");
  });
});

describe("buildReviewReplyDraft", () => {
  it("greets by first name and thanks for a positive review", () => {
    const { reply, sentiment } = buildReviewReplyDraft({
      businessName: "Acme Cafe",
      rating: 5,
      authorName: "Priya Sharma",
    });
    expect(sentiment).toBe("positive");
    expect(reply.startsWith("Hi Priya,")).toBe(true);
    expect(reply).toContain("Acme Cafe");
  });

  it("uses a neutral, fallback greeting when the author is unknown", () => {
    const { reply } = buildReviewReplyDraft({ businessName: "Acme", rating: 3 });
    expect(reply.startsWith("Hi there,")).toBe(true);
  });

  it("apologizes and offers to make it right for a negative review", () => {
    const { reply, sentiment } = buildReviewReplyDraft({
      businessName: "Acme",
      rating: 1,
      authorName: "Sam",
    });
    expect(sentiment).toBe("negative");
    expect(reply.toLowerCase()).toContain("sorry");
    expect(reply.toLowerCase()).toContain("make it right");
  });

  it("offers a professional tone variant", () => {
    const warm = buildReviewReplyDraft({ businessName: "Acme", rating: 5 }).reply;
    const pro = buildReviewReplyDraft({ businessName: "Acme", rating: 5, tone: "professional" }).reply;
    expect(pro).not.toBe(warm);
    expect(pro).toContain("appreciate");
  });
});

describe("summarizeReviews", () => {
  it("computes count, average, distribution and unanswered", () => {
    const summary = summarizeReviews([
      { rating: 5, status: GmbReviewStatus.NEW },
      { rating: 4, status: GmbReviewStatus.REPLIED },
      { rating: 1, status: GmbReviewStatus.NEW },
    ]);
    expect(summary.count).toBe(3);
    expect(summary.average).toBe(3.33);
    expect(summary.distribution[5]).toBe(1);
    expect(summary.distribution[4]).toBe(1);
    expect(summary.distribution[1]).toBe(1);
    expect(summary.unanswered).toBe(2);
  });

  it("returns a zeroed summary for no reviews", () => {
    const summary = summarizeReviews([]);
    expect(summary.count).toBe(0);
    expect(summary.average).toBe(0);
    expect(summary.unanswered).toBe(0);
  });
});
