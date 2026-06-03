import { describe, expect, it } from "vitest";
import {
  classifyCreditLineOverdue,
  daysOverdue,
} from "./platformMonitor.service";

describe("daysOverdue", () => {
  const now = new Date("2026-06-03T12:00:00Z");

  it("returns 0 for a line due earlier the same day (floor)", () => {
    expect(daysOverdue(new Date("2026-06-03T01:00:00Z"), now)).toBe(0);
  });

  it("returns whole days past due, floored", () => {
    // 3.5 days earlier → floor 3
    expect(daysOverdue(new Date("2026-05-31T00:00:00Z"), now)).toBe(3);
  });

  it("returns a negative number when the line isn't due yet", () => {
    expect(daysOverdue(new Date("2026-06-10T12:00:00Z"), now)).toBe(-7);
  });

  it("handles exactly N*24h cleanly", () => {
    expect(daysOverdue(new Date("2026-06-01T12:00:00Z"), now)).toBe(2);
  });
});

describe("classifyCreditLineOverdue", () => {
  it("returns null for a not-yet-due line (<=0 days)", () => {
    expect(classifyCreditLineOverdue(0).severity).toBeNull();
    expect(classifyCreditLineOverdue(-5).severity).toBeNull();
  });

  it("returns MEDIUM for 1–6 days overdue", () => {
    expect(classifyCreditLineOverdue(1).severity).toBe("MEDIUM");
    expect(classifyCreditLineOverdue(6).severity).toBe("MEDIUM");
  });

  it("returns HIGH at the 7-day boundary through 30", () => {
    expect(classifyCreditLineOverdue(7).severity).toBe("HIGH");
    expect(classifyCreditLineOverdue(30).severity).toBe("HIGH");
  });

  it("returns URGENT past 30 days", () => {
    expect(classifyCreditLineOverdue(31).severity).toBe("URGENT");
    expect(classifyCreditLineOverdue(365).severity).toBe("URGENT");
  });

  it("returns null on NaN / Infinity (non-finite guard)", () => {
    expect(classifyCreditLineOverdue(Number.NaN).severity).toBeNull();
    expect(
      classifyCreditLineOverdue(Number.POSITIVE_INFINITY).severity,
    ).toBeNull();
  });

  it("severity escalates monotonically with days overdue", () => {
    const rank = { MEDIUM: 0, HIGH: 1, URGENT: 2 } as const;
    const samples = [1, 6, 7, 15, 30, 31, 90];
    let last = -1;
    for (const d of samples) {
      const sev = classifyCreditLineOverdue(d).severity;
      expect(sev).not.toBeNull();
      const r = rank[sev as keyof typeof rank];
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });
});
