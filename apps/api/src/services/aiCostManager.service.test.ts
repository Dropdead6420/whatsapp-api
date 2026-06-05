import { describe, expect, it } from "vitest";
import { summarizeAiUsage, type AiUsageEvent } from "./aiCostManager.service";

function ev(over: Partial<AiUsageEvent> = {}): AiUsageEvent {
  return {
    model: "claude-3-5-sonnet",
    feature: "copywriting",
    inputTokens: 100,
    outputTokens: 50,
    costInCents: 10,
    createdAt: new Date("2026-06-01T09:00:00Z"),
    ...over,
  };
}

describe("summarizeAiUsage", () => {
  it("returns zeroed summary for no events", () => {
    const s = summarizeAiUsage([], 30);
    expect(s).toMatchObject({
      sinceDays: 30,
      totalEvents: 0,
      totalCostCents: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      byModel: [],
      byFeature: [],
      byDay: [],
    });
  });

  it("totals cost and tokens across events", () => {
    const s = summarizeAiUsage(
      [ev({ costInCents: 10, inputTokens: 100, outputTokens: 50 }), ev({ costInCents: 5, inputTokens: 20, outputTokens: 10 })],
      7,
    );
    expect(s.totalEvents).toBe(2);
    expect(s.totalCostCents).toBe(15);
    expect(s.totalInputTokens).toBe(120);
    expect(s.totalOutputTokens).toBe(60);
  });

  it("buckets by model, sorted by cost desc", () => {
    const s = summarizeAiUsage(
      [
        ev({ model: "gpt-4o", costInCents: 3 }),
        ev({ model: "claude-3-5-sonnet", costInCents: 20 }),
        ev({ model: "gpt-4o", costInCents: 4 }),
      ],
      30,
    );
    expect(s.byModel.map((b) => b.key)).toEqual(["claude-3-5-sonnet", "gpt-4o"]);
    expect(s.byModel[0]).toMatchObject({ events: 1, costCents: 20 });
    expect(s.byModel[1]).toMatchObject({ events: 2, costCents: 7 });
  });

  it("buckets by feature", () => {
    const s = summarizeAiUsage(
      [ev({ feature: "intent_detection", costInCents: 2 }), ev({ feature: "copywriting", costInCents: 9 })],
      30,
    );
    expect(s.byFeature.map((b) => b.key)).toEqual(["copywriting", "intent_detection"]);
  });

  it("buckets by UTC day, chronologically", () => {
    const s = summarizeAiUsage(
      [
        ev({ createdAt: new Date("2026-06-02T01:00:00Z"), costInCents: 4 }),
        ev({ createdAt: new Date("2026-06-01T23:00:00Z"), costInCents: 6 }),
        ev({ createdAt: new Date("2026-06-02T10:00:00Z"), costInCents: 1 }),
      ],
      30,
    );
    expect(s.byDay).toEqual([
      { date: "2026-06-01", events: 1, costCents: 6 },
      { date: "2026-06-02", events: 2, costCents: 5 },
    ]);
  });
});
