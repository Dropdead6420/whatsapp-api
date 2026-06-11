import { describe, expect, it } from "vitest";
import { PARTNER_CSV_HEADERS, partnersToCsv } from "./partnersCsv";

describe("partnersToCsv", () => {
  it("starts with the header row", () => {
    expect(partnersToCsv([]).trim()).toBe(PARTNER_CSV_HEADERS.join(","));
  });

  it("emits one line per partner with numbers passed through", () => {
    const csv = partnersToCsv([
      { name: "Acme", type: "Reseller (A)", walletBalance: 4200, totalOrgs: 3, gmbOrgs: 2 },
    ]);
    expect(csv.split("\n")).toEqual([
      "Partner Name,Type,Wallet Balance,Total Orgs,GMB Orgs",
      "Acme,Reseller (A),4200,3,2",
    ]);
  });

  it("quotes cells containing commas and escapes embedded quotes", () => {
    const csv = partnersToCsv([
      { name: 'Smith, Jones & Co "Agency"', type: "Hybrid (C)", walletBalance: 0, totalOrgs: 0, gmbOrgs: 0 },
    ]);
    expect(csv.split("\n")[1]).toBe('"Smith, Jones & Co ""Agency""",Hybrid (C),0,0,0');
  });
});
