import { describe, expect, it } from "vitest";
import { analyticsSummaryToPdf, pdfEscape } from "./analyticsPdf.service";

describe("pdfEscape", () => {
  it("escapes PDF text delimiters and flattens newlines", () => {
    expect(pdfEscape("A (test) \\ value\nnext")).toBe(
      "A \\(test\\) \\\\ value next",
    );
  });
});

describe("analyticsSummaryToPdf", () => {
  it("renders a valid PDF document with analytics rows", () => {
    const pdf = analyticsSummaryToPdf({
      scope: "tenant",
      totals: { contacts: 12, messagesMonth: 50 },
      sendQuota: {
        monthlyUsed: 50,
        monthlyQuota: null,
        monthlySafetyCapEnabled: false,
        percentUsed: null,
      },
      campaignsByStatus: { DRAFT: 1, COMPLETED: 2 },
    });

    const text = pdf.toString("utf8");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/BaseFont /Helvetica");
    expect(text).toContain("NexaFlow Analytics Report");
    expect(text).toContain("Totals | contacts | 12");
    expect(text).toContain("Campaigns By Status | COMPLETED | 2");
    expect(text.trim().endsWith("%%EOF")).toBe(true);
  });
});
