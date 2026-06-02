import { describe, expect, it } from "vitest";
import {
  buildInvoiceNumber,
  formatInvoiceMonthPrefix,
  nextInvoiceSequence,
} from "./invoice.service";

describe("formatInvoiceMonthPrefix", () => {
  it("formats a typical date as YYMM", () => {
    expect(formatInvoiceMonthPrefix(new Date("2026-06-15T12:00:00Z"))).toBe(
      "2606",
    );
  });

  it("pads single-digit months", () => {
    expect(formatInvoiceMonthPrefix(new Date("2026-01-01T00:00:00Z"))).toBe(
      "2601",
    );
  });

  it("uses UTC, not local time (no off-by-one near month boundary)", () => {
    // 2026-07-01 00:30 UTC is still July UTC even if local is June.
    expect(formatInvoiceMonthPrefix(new Date("2026-07-01T00:30:00Z"))).toBe(
      "2607",
    );
  });

  it("uses two-digit year (wraps 2099→99, 2100→00)", () => {
    expect(formatInvoiceMonthPrefix(new Date("2099-06-15T12:00:00Z"))).toBe(
      "9906",
    );
    expect(formatInvoiceMonthPrefix(new Date("2100-06-15T12:00:00Z"))).toBe(
      "0006",
    );
  });
});

describe("buildInvoiceNumber", () => {
  it("builds INV-YYMM-NNNN with zero-padded seq", () => {
    expect(buildInvoiceNumber("2606", 1)).toBe("INV-2606-0001");
    expect(buildInvoiceNumber("2606", 42)).toBe("INV-2606-0042");
    expect(buildInvoiceNumber("2606", 1234)).toBe("INV-2606-1234");
  });

  it("rejects sub-1 sequence numbers", () => {
    expect(() => buildInvoiceNumber("2606", 0)).toThrow(/positive/i);
    expect(() => buildInvoiceNumber("2606", -1)).toThrow(/positive/i);
  });

  it("rejects fractional sequence numbers", () => {
    expect(() => buildInvoiceNumber("2606", 1.5)).toThrow(/positive/i);
  });

  it("rejects badly-formatted month prefix", () => {
    expect(() => buildInvoiceNumber("26-06", 1)).toThrow(/4 digits/i);
    expect(() => buildInvoiceNumber("266", 1)).toThrow(/4 digits/i);
    expect(() => buildInvoiceNumber("abcd", 1)).toThrow(/4 digits/i);
  });

  it("handles seq beyond 9999 (just longer, still lex-orderable past 9999 by length)", () => {
    expect(buildInvoiceNumber("2606", 10_000)).toBe("INV-2606-10000");
  });
});

describe("nextInvoiceSequence", () => {
  it("returns 1 when no existing invoices match", () => {
    expect(
      nextInvoiceSequence({
        monthPrefix: "2606",
        existingNumbers: [],
      }),
    ).toBe(1);
  });

  it("returns max+1 when invoices already exist for this month", () => {
    expect(
      nextInvoiceSequence({
        monthPrefix: "2606",
        existingNumbers: ["INV-2606-0001", "INV-2606-0002", "INV-2606-0003"],
      }),
    ).toBe(4);
  });

  it("ignores invoices from other months", () => {
    expect(
      nextInvoiceSequence({
        monthPrefix: "2606",
        existingNumbers: ["INV-2605-0099", "INV-2607-0001"],
      }),
    ).toBe(1);
  });

  it("ignores malformed invoice numbers gracefully", () => {
    expect(
      nextInvoiceSequence({
        monthPrefix: "2606",
        existingNumbers: [
          "INV-2606-0042",
          "garbage",
          "INV-2606-not-a-number",
          "OLD-FORMAT-100",
        ],
      }),
    ).toBe(43);
  });

  it("survives gaps in the sequence (returns max+1, not gap-fill)", () => {
    // We do NOT reuse gaps — finance teams find that confusing.
    expect(
      nextInvoiceSequence({
        monthPrefix: "2606",
        existingNumbers: ["INV-2606-0001", "INV-2606-0005"],
      }),
    ).toBe(6);
  });

  it("doesn't underflow on prefix-only false-match", () => {
    // "INV-26060" isn't a 2606 invoice — the dash boundary matters.
    expect(
      nextInvoiceSequence({
        monthPrefix: "2606",
        existingNumbers: ["INV-26060-0001"],
      }),
    ).toBe(1);
  });
});
