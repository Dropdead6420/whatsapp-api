import { describe, expect, it } from "vitest";
import {
  nextStatus,
  sanitizeDueAt,
  sanitizeNotes,
  sanitizeTitle,
} from "./followUpTask.service";

describe("nextStatus", () => {
  it("PENDING → DONE is allowed", () => {
    expect(nextStatus("PENDING", "DONE")).toBe("DONE");
  });

  it("PENDING → CANCELLED is allowed", () => {
    expect(nextStatus("PENDING", "CANCELLED")).toBe("CANCELLED");
  });

  it("DONE → anything is rejected (terminal)", () => {
    expect(() => nextStatus("DONE", "PENDING")).toThrow(/finalize/i);
    expect(() => nextStatus("DONE", "CANCELLED")).toThrow(/finalize/i);
  });

  it("CANCELLED → anything is rejected (terminal)", () => {
    expect(() => nextStatus("CANCELLED", "PENDING")).toThrow(/finalize/i);
    expect(() => nextStatus("CANCELLED", "DONE")).toThrow(/finalize/i);
  });

  it("self-transition is rejected", () => {
    expect(() => nextStatus("PENDING", "PENDING")).toThrow(/already/i);
    expect(() => nextStatus("DONE", "DONE")).toThrow(/already/i);
    expect(() => nextStatus("CANCELLED", "CANCELLED")).toThrow(/already/i);
  });
});

describe("sanitizeTitle", () => {
  it("trims and returns valid title", () => {
    expect(sanitizeTitle("  Call back Tuesday  ")).toBe("Call back Tuesday");
  });

  it("rejects empty title", () => {
    expect(() => sanitizeTitle("")).toThrow(/required/i);
  });

  it("rejects whitespace-only title", () => {
    expect(() => sanitizeTitle("    ")).toThrow(/required/i);
  });

  it("caps at 280 characters", () => {
    const long = "x".repeat(500);
    expect(sanitizeTitle(long)).toHaveLength(280);
  });
});

describe("sanitizeNotes", () => {
  it("null stays null", () => {
    expect(sanitizeNotes(null)).toBeNull();
  });

  it("undefined becomes null", () => {
    expect(sanitizeNotes(undefined)).toBeNull();
  });

  it("empty + whitespace become null (so DB stores NULL, not '')", () => {
    expect(sanitizeNotes("")).toBeNull();
    expect(sanitizeNotes("   \n  ")).toBeNull();
  });

  it("trims valid notes", () => {
    expect(sanitizeNotes("  some context  ")).toBe("some context");
  });

  it("caps at 4000 characters", () => {
    const long = "n".repeat(5000);
    const result = sanitizeNotes(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(4000);
  });
});

describe("sanitizeDueAt", () => {
  it("accepts a Date object", () => {
    const future = new Date(Date.now() + 60_000);
    expect(sanitizeDueAt(future).getTime()).toBe(future.getTime());
  });

  it("accepts an ISO string", () => {
    const future = new Date(Date.now() + 60_000);
    expect(sanitizeDueAt(future.toISOString()).getTime()).toBe(
      future.getTime(),
    );
  });

  it("accepts a numeric epoch ms", () => {
    const future = Date.now() + 60_000;
    expect(sanitizeDueAt(future).getTime()).toBe(future);
  });

  it("rejects invalid strings", () => {
    expect(() => sanitizeDueAt("not-a-date")).toThrow(/invalid/i);
  });

  it("rejects timestamps more than a day in the past", () => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(() => sanitizeDueAt(past)).toThrow(/past/i);
  });

  it("accepts due dates up to 1 day in the past (small clock skew tolerance)", () => {
    // 12 hours ago — still within the 1-day tolerance window.
    const recentPast = new Date(Date.now() - 12 * 60 * 60 * 1000);
    expect(() => sanitizeDueAt(recentPast)).not.toThrow();
  });

  it("accepts due dates far in the future", () => {
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    expect(() => sanitizeDueAt(farFuture)).not.toThrow();
  });
});
