import { describe, expect, it } from "vitest";
import { RetentionTier, LifecycleStage } from "@nexaflow/db";
import { scoreContact } from "./contactRetention.service";

const NOW = new Date("2026-05-30T00:00:00.000Z");

function contact(overrides: Partial<Parameters<typeof scoreContact>[0]> = {}) {
  return {
    id: "c_1",
    name: "Test Contact",
    phoneNumber: "+10000000000",
    optedOut: false,
    lifecycleStage: LifecycleStage.CUSTOMER,
    aiScore: null,
    lastInteractionAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

describe("scoreContact", () => {
  it("rates a recently-active contact ACTIVE with a high score", () => {
    const result = scoreContact(contact({ lastInteractionAt: daysAgo(3) }), NOW);
    expect(result.tier).toBe(RetentionTier.ACTIVE);
    expect(result.score).toBeGreaterThan(70);
    expect(result.daysSinceInteraction).toBe(3);
  });

  it("rates a 20-day-quiet contact COOLING", () => {
    const result = scoreContact(contact({ lastInteractionAt: daysAgo(20) }), NOW);
    expect(result.tier).toBe(RetentionTier.COOLING);
  });

  it("rates a 45-day-quiet contact DORMANT", () => {
    const result = scoreContact(contact({ lastInteractionAt: daysAgo(45) }), NOW);
    expect(result.tier).toBe(RetentionTier.DORMANT);
    expect(result.recommendation.toLowerCase()).toContain("win-back");
  });

  it("rates a 200-day-quiet contact LOST", () => {
    const result = scoreContact(contact({ lastInteractionAt: daysAgo(200) }), NOW);
    expect(result.tier).toBe(RetentionTier.LOST);
  });

  it("forces opted-out contacts to LOST with score 0 regardless of recency", () => {
    const result = scoreContact(
      contact({ optedOut: true, lastInteractionAt: daysAgo(1) }),
      NOW,
    );
    expect(result.tier).toBe(RetentionTier.LOST);
    expect(result.score).toBe(0);
  });

  it("falls back to createdAt when lastInteractionAt is null", () => {
    const result = scoreContact(
      contact({ lastInteractionAt: null, createdAt: daysAgo(50) }),
      NOW,
    );
    expect(result.daysSinceInteraction).toBe(50);
    expect(result.tier).toBe(RetentionTier.DORMANT);
    expect(result.factors.recency.detail).toContain("No interaction yet");
  });

  it("weights a VIP higher than a cold LEAD at the same recency", () => {
    const vip = scoreContact(
      contact({ lifecycleStage: LifecycleStage.VIP, lastInteractionAt: daysAgo(20) }),
      NOW,
    );
    const lead = scoreContact(
      contact({ lifecycleStage: LifecycleStage.LEAD, lastInteractionAt: daysAgo(20) }),
      NOW,
    );
    expect(vip.score).toBeGreaterThan(lead.score);
  });

  it("incorporates the AI lead score into the intent factor", () => {
    const withScore = scoreContact(
      contact({ aiScore: 0.9, lastInteractionAt: daysAgo(20) }),
      NOW,
    );
    const withoutScore = scoreContact(
      contact({ aiScore: 0.1, lastInteractionAt: daysAgo(20) }),
      NOW,
    );
    expect(withScore.score).toBeGreaterThan(withoutScore.score);
    expect(withScore.factors.intent.detail).toContain("AI lead score");
  });
});
