import { describe, expect, it } from "vitest";
import {
  resolveWindow,
  summarizeAgentRows,
} from "./agentPerformance.service";

describe("resolveWindow", () => {
  it("defaults to 14 days for undefined input", () => {
    const { windowDays } = resolveWindow(undefined);
    expect(windowDays).toBe(14);
  });

  it("defaults to 14 days for non-numeric strings", () => {
    expect(resolveWindow("nope").windowDays).toBe(14);
    expect(resolveWindow("").windowDays).toBe(14);
  });

  it("parses numeric strings", () => {
    expect(resolveWindow("30").windowDays).toBe(30);
    expect(resolveWindow("7").windowDays).toBe(7);
  });

  it("accepts already-numeric input", () => {
    expect(resolveWindow(45).windowDays).toBe(45);
  });

  it("clamps to a [1, 90] range", () => {
    expect(resolveWindow(0).windowDays).toBe(1);
    expect(resolveWindow(-5).windowDays).toBe(1);
    expect(resolveWindow(150).windowDays).toBe(90);
    expect(resolveWindow("9999").windowDays).toBe(90);
  });

  it("truncates fractional days (no half-days)", () => {
    expect(resolveWindow(7.9).windowDays).toBe(7);
  });

  it("windowStart is roughly now - windowDays * 86400s", () => {
    const before = Date.now();
    const { windowDays, windowStart } = resolveWindow(10);
    const after = Date.now();
    const lower = before - windowDays * 86_400_000;
    const upper = after - windowDays * 86_400_000;
    expect(windowStart.getTime()).toBeGreaterThanOrEqual(lower);
    expect(windowStart.getTime()).toBeLessThanOrEqual(upper);
  });
});

describe("summarizeAgentRows", () => {
  const agentA = { id: "a", name: "Alice", email: "a@x.com" };
  const agentB = { id: "b", name: "Bob", email: "b@x.com" };
  const agentC = { id: "c", name: "Carol", email: "c@x.com" };

  it("returns one row per active agent even with zero stats", () => {
    const out = summarizeAgentRows([agentA, agentB], new Map());
    expect(out).toHaveLength(2);
    for (const row of out) {
      expect(row.openConversationCount).toBe(0);
      expect(row.handledInWindow).toBe(0);
      expect(row.avgFirstResponseSeconds).toBeNull();
      expect(row.slaBreachedCount).toBe(0);
    }
  });

  it("sorts by busiest (handledInWindow desc) then alphabetical", () => {
    const stats = new Map([
      [
        "a",
        {
          agentId: "a",
          openConversationCount: 0,
          handledInWindow: 5,
          firstResponseSecondsSum: 0,
          firstResponseSamples: 0,
          slaBreachedCount: 0,
        },
      ],
      [
        "c",
        {
          agentId: "c",
          openConversationCount: 0,
          handledInWindow: 5,
          firstResponseSecondsSum: 0,
          firstResponseSamples: 0,
          slaBreachedCount: 0,
        },
      ],
      [
        "b",
        {
          agentId: "b",
          openConversationCount: 0,
          handledInWindow: 12,
          firstResponseSecondsSum: 0,
          firstResponseSamples: 0,
          slaBreachedCount: 0,
        },
      ],
    ]);
    const out = summarizeAgentRows([agentA, agentB, agentC], stats);
    expect(out.map((r) => r.agentId)).toEqual(["b", "a", "c"]);
  });

  it("computes integer average first-response from samples", () => {
    const stats = new Map([
      [
        "a",
        {
          agentId: "a",
          openConversationCount: 1,
          handledInWindow: 3,
          firstResponseSecondsSum: 100,
          firstResponseSamples: 3,
          slaBreachedCount: 0,
        },
      ],
    ]);
    const out = summarizeAgentRows([agentA], stats);
    expect(out[0].avgFirstResponseSeconds).toBe(33); // 100/3 → 33
  });

  it("returns null avg when samples=0 (no first-response data)", () => {
    const stats = new Map([
      [
        "a",
        {
          agentId: "a",
          openConversationCount: 2,
          handledInWindow: 2,
          firstResponseSecondsSum: 0,
          firstResponseSamples: 0,
          slaBreachedCount: 1,
        },
      ],
    ]);
    const out = summarizeAgentRows([agentA], stats);
    expect(out[0].avgFirstResponseSeconds).toBeNull();
    expect(out[0].slaBreachedCount).toBe(1);
  });

  it("does not surface stats for agents not in the agent list (deleted/suspended)", () => {
    const stats = new Map([
      [
        "ghost",
        {
          agentId: "ghost",
          openConversationCount: 50,
          handledInWindow: 50,
          firstResponseSecondsSum: 0,
          firstResponseSamples: 0,
          slaBreachedCount: 50,
        },
      ],
    ]);
    const out = summarizeAgentRows([agentA], stats);
    expect(out).toHaveLength(1);
    expect(out[0].agentId).toBe("a");
    // ghost stat would otherwise pollute the dashboard — must not appear.
    expect(out.find((r) => r.agentId === "ghost")).toBeUndefined();
  });

  it("respects 0-conversation agents in alphabetical tiebreak", () => {
    const out = summarizeAgentRows([agentC, agentA, agentB], new Map());
    // all zero handled → sort alphabetical by name
    expect(out.map((r) => r.agentName)).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("includes openConversationCount in the row even when stat is partial", () => {
    const stats = new Map([
      [
        "a",
        {
          agentId: "a",
          openConversationCount: 7,
          handledInWindow: 0,
          firstResponseSecondsSum: 0,
          firstResponseSamples: 0,
          slaBreachedCount: 0,
        },
      ],
    ]);
    const out = summarizeAgentRows([agentA], stats);
    expect(out[0].openConversationCount).toBe(7);
    expect(out[0].handledInWindow).toBe(0);
  });
});
