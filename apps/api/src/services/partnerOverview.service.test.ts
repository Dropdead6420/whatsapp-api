import { describe, expect, it } from "vitest";
import { summarizePartner, summarizePartners } from "./partnerOverview.service";

describe("summarizePartner", () => {
  it("uses the PARTNER_CREDIT wallet balance and counts orgs + GMB-active orgs", () => {
    const row = summarizePartner({
      id: "p1",
      name: "Acme Agency",
      partnerModel: "RESELLER",
      wallets: [
        { type: "AI_CREDIT", balanceCredits: 999 },
        { type: "PARTNER_CREDIT", balanceCredits: 4200 },
      ],
      children: [{ gmbLocations: 3 }, { gmbLocations: 0 }, { gmbLocations: 1 }],
    });
    expect(row).toEqual({
      id: "p1",
      name: "Acme Agency",
      type: "RESELLER",
      walletBalance: 4200, // PARTNER_CREDIT, not the AI_CREDIT 999
      totalOrgs: 3,
      gmbOrgs: 2, // two children have >0 locations
    });
  });

  it("defaults the balance to 0 when the partner has no PARTNER_CREDIT wallet", () => {
    const row = summarizePartner({
      id: "p2",
      name: "New Partner",
      partnerModel: "HYBRID",
      wallets: [{ type: "AI_CREDIT", balanceCredits: 50 }],
      children: [],
    });
    expect(row.walletBalance).toBe(0);
    expect(row.totalOrgs).toBe(0);
    expect(row.gmbOrgs).toBe(0);
  });
});

describe("summarizePartners", () => {
  it("sorts richest-first by wallet balance, then by name", () => {
    const rows = summarizePartners([
      { id: "a", name: "Bravo", partnerModel: "RESELLER", wallets: [{ type: "PARTNER_CREDIT", balanceCredits: 100 }], children: [] },
      { id: "b", name: "Zeta", partnerModel: "HYBRID", wallets: [{ type: "PARTNER_CREDIT", balanceCredits: 900 }], children: [] },
      { id: "c", name: "Alpha", partnerModel: "RESELLER", wallets: [{ type: "PARTNER_CREDIT", balanceCredits: 100 }], children: [] },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Zeta", "Alpha", "Bravo"]);
  });
});
