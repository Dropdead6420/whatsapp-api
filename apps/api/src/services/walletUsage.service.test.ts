import { describe, expect, it } from "vitest";
import {
  aggregateUsageByDay,
  categorizeTransactionType,
  resolveUsageWindow,
  type UsageInputRow,
} from "./walletUsage.service";

describe("categorizeTransactionType", () => {
  it("maps the three debit types", () => {
    expect(categorizeTransactionType("MESSAGE_DEBIT")).toBe("messaging");
    expect(categorizeTransactionType("AI_DEBIT")).toBe("ai");
    expect(categorizeTransactionType("WORKFLOW_DEBIT")).toBe("workflow");
  });

  it("everything else is 'other'", () => {
    expect(categorizeTransactionType("MANUAL_ADJUSTMENT")).toBe("other");
    expect(categorizeTransactionType("EXPIRY")).toBe("other");
    expect(categorizeTransactionType("WHATEVER")).toBe("other");
  });
});

describe("resolveUsageWindow", () => {
  it("defaults to 30 days", () => {
    expect(resolveUsageWindow(undefined).windowDays).toBe(30);
    expect(resolveUsageWindow("nope").windowDays).toBe(30);
  });

  it("parses numeric strings + numbers", () => {
    expect(resolveUsageWindow("7").windowDays).toBe(7);
    expect(resolveUsageWindow(14).windowDays).toBe(14);
  });

  it("clamps to [1, 90]", () => {
    expect(resolveUsageWindow(0).windowDays).toBe(1);
    expect(resolveUsageWindow(-5).windowDays).toBe(1);
    expect(resolveUsageWindow(1000).windowDays).toBe(90);
  });

  it("windowStart is at UTC midnight", () => {
    const { windowStart } = resolveUsageWindow(7);
    expect(windowStart.getUTCHours()).toBe(0);
    expect(windowStart.getUTCMinutes()).toBe(0);
    expect(windowStart.getUTCSeconds()).toBe(0);
  });
});

describe("aggregateUsageByDay", () => {
  const now = new Date("2026-06-03T12:00:00Z");
  const windowStart = new Date("2026-06-01T00:00:00Z"); // 3-day window

  function row(
    partial: Partial<UsageInputRow> & { createdAt: Date },
  ): UsageInputRow {
    return {
      type: "MESSAGE_DEBIT",
      direction: "DEBIT",
      amountCredits: 10,
      ...partial,
    };
  }

  it("emits one dense bucket per day in the window even with no usage", () => {
    const out = aggregateUsageByDay([], { windowStart, now });
    expect(out.days.map((d) => d.day)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
    ]);
    expect(out.totalDebited).toBe(0);
  });

  it("buckets a debit into the right day + category", () => {
    const out = aggregateUsageByDay(
      [row({ createdAt: new Date("2026-06-02T09:00:00Z"), amountCredits: 25 })],
      { windowStart, now },
    );
    const june2 = out.days.find((d) => d.day === "2026-06-02")!;
    expect(june2.messaging).toBe(25);
    expect(june2.total).toBe(25);
    expect(out.byCategory.messaging).toBe(25);
    expect(out.totalDebited).toBe(25);
  });

  it("splits categories within the same day", () => {
    const out = aggregateUsageByDay(
      [
        row({ type: "MESSAGE_DEBIT", createdAt: new Date("2026-06-03T01:00:00Z"), amountCredits: 5 }),
        row({ type: "AI_DEBIT", createdAt: new Date("2026-06-03T02:00:00Z"), amountCredits: 7 }),
        row({ type: "WORKFLOW_DEBIT", createdAt: new Date("2026-06-03T03:00:00Z"), amountCredits: 3 }),
      ],
      { windowStart, now },
    );
    const june3 = out.days.find((d) => d.day === "2026-06-03")!;
    expect(june3.messaging).toBe(5);
    expect(june3.ai).toBe(7);
    expect(june3.workflow).toBe(3);
    expect(june3.total).toBe(15);
  });

  it("ignores CREDIT rows (usage graph, not balance graph)", () => {
    const out = aggregateUsageByDay(
      [
        row({ direction: "CREDIT", createdAt: new Date("2026-06-02T09:00:00Z"), amountCredits: 1000 }),
      ],
      { windowStart, now },
    );
    expect(out.totalDebited).toBe(0);
  });

  it("ignores rows before the window start", () => {
    const out = aggregateUsageByDay(
      [row({ createdAt: new Date("2026-05-30T09:00:00Z"), amountCredits: 99 })],
      { windowStart, now },
    );
    expect(out.totalDebited).toBe(0);
  });

  it("clamps negative amounts to 0 (defensive)", () => {
    const out = aggregateUsageByDay(
      [row({ createdAt: new Date("2026-06-02T09:00:00Z"), amountCredits: -50 })],
      { windowStart, now },
    );
    expect(out.totalDebited).toBe(0);
  });

  it("category totals + grand total stay consistent", () => {
    const out = aggregateUsageByDay(
      [
        row({ type: "MESSAGE_DEBIT", createdAt: new Date("2026-06-01T09:00:00Z"), amountCredits: 10 }),
        row({ type: "AI_DEBIT", createdAt: new Date("2026-06-02T09:00:00Z"), amountCredits: 20 }),
        row({ type: "MANUAL_ADJUSTMENT", createdAt: new Date("2026-06-03T09:00:00Z"), amountCredits: 30 }),
      ],
      { windowStart, now },
    );
    const sumCats =
      out.byCategory.messaging +
      out.byCategory.ai +
      out.byCategory.workflow +
      out.byCategory.other;
    expect(sumCats).toBe(out.totalDebited);
    expect(out.totalDebited).toBe(60);
    expect(out.byCategory.other).toBe(30);
  });
});
