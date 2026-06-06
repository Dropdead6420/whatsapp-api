import { describe, expect, it } from "vitest";
import { mergeTimeline, type TimelineEvent } from "./cdpTimeline.service";

function ev(type: TimelineEvent["type"], at: Date, id: string): TimelineEvent {
  return { type, at, title: type, sourceId: id };
}

describe("mergeTimeline", () => {
  it("sorts newest-first across sources", () => {
    const merged = mergeTimeline([
      ev("lead", new Date("2026-01-01"), "l1"),
      ev("call", new Date("2026-03-01"), "c1"),
      ev("appointment", new Date("2026-02-01"), "a1"),
    ]);
    expect(merged.map((e) => e.sourceId)).toEqual(["c1", "a1", "l1"]);
  });

  it("drops events with an invalid timestamp", () => {
    const merged = mergeTimeline([
      ev("call", new Date("2026-01-01"), "ok"),
      ev("lead", new Date("not-a-date"), "bad"),
    ]);
    expect(merged.map((e) => e.sourceId)).toEqual(["ok"]);
  });

  it("caps to the requested limit", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      ev("conversation", new Date(2026, 0, i + 1), `c${i}`),
    );
    expect(mergeTimeline(many, 3)).toHaveLength(3);
  });

  it("clamps the limit into [1, 200]", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      ev("conversation", new Date(2026, 0, i + 1), `c${i}`),
    );
    expect(mergeTimeline(many, 0)).toHaveLength(1);
    expect(mergeTimeline(many, 999)).toHaveLength(5);
  });
});
