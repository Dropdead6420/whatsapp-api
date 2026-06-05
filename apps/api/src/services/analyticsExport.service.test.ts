import { describe, expect, it } from "vitest";
import {
  analyticsSummaryToCsvRows,
  csvEscape,
  csvRowsToString,
} from "./analyticsExport.service";

describe("csvEscape", () => {
  it("leaves simple cells untouched", () => {
    expect(csvEscape("messagesMonth")).toBe("messagesMonth");
    expect(csvEscape(42)).toBe("42");
  });

  it("quotes commas, quotes, and newlines", () => {
    expect(csvEscape("hello, world")).toBe('"hello, world"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line\nbreak")).toBe('"line\nbreak"');
  });
});

describe("analyticsSummaryToCsvRows", () => {
  it("flattens tenant summary sections into report rows", () => {
    const rows = analyticsSummaryToCsvRows({
      scope: "tenant",
      totals: { contacts: 12, messagesMonth: 50 },
      sendQuota: {
        monthlyUsed: 50,
        monthlyQuota: null,
        monthlySafetyCapEnabled: false,
        percentUsed: null,
      },
      planQuotas: {
        contacts: { used: 12, limit: 1000 },
        campaigns: { used: 2, limit: 10 },
      },
      leadsByStatus: { NEW: 3, QUALIFIED: 2 },
      campaignsByStatus: { DRAFT: 1, COMPLETED: 1 },
    });

    expect(rows).toEqual(
      expect.arrayContaining([
        { section: "Report", metric: "scope", value: "tenant" },
        { section: "Totals", metric: "contacts", value: 12 },
        { section: "Send Quota", metric: "monthlySafetyCapEnabled", value: false },
        { section: "Plan Quotas", metric: "contacts.limit", value: 1000 },
        { section: "Leads By Status", metric: "NEW", value: 3 },
        { section: "Campaigns By Status", metric: "COMPLETED", value: 1 },
      ]),
    );
  });
});

describe("csvRowsToString", () => {
  it("renders a stable header and rows", () => {
    const csv = csvRowsToString([
      { section: "Totals", metric: "contacts", value: 12 },
      { section: "Totals", metric: "note", value: "a,b" },
    ]);

    expect(csv).toBe(
      'Section,Metric,Value\nTotals,contacts,12\nTotals,note,"a,b"\n',
    );
  });
});
