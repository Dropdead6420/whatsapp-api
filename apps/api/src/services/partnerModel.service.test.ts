import { describe, expect, it } from "vitest";
import {
  allowedOwnershipsFor,
  assertValidPartnerModelConfig,
  defaultCustomerConfigFor,
  isOwnershipAllowed,
  isPartnerFundedSource,
} from "./partnerModel.service";

describe("allowedOwnershipsFor", () => {
  it("RESELLER → NexaFlow-owned only", () => {
    expect(allowedOwnershipsFor("RESELLER")).toEqual(["NEXAFLOW_OWNED"]);
  });
  it("BRING_YOUR_OWN_META → partner-owned only", () => {
    expect(allowedOwnershipsFor("BRING_YOUR_OWN_META")).toEqual(["PARTNER_OWNED"]);
  });
  it("HYBRID → all three", () => {
    expect(allowedOwnershipsFor("HYBRID")).toEqual([
      "NEXAFLOW_OWNED",
      "PARTNER_OWNED",
      "CUSTOMER_OWNED",
    ]);
  });
});

describe("isOwnershipAllowed", () => {
  it("RESELLER rejects partner/customer-owned providers", () => {
    expect(isOwnershipAllowed("RESELLER", "NEXAFLOW_OWNED")).toBe(true);
    expect(isOwnershipAllowed("RESELLER", "PARTNER_OWNED")).toBe(false);
    expect(isOwnershipAllowed("RESELLER", "CUSTOMER_OWNED")).toBe(false);
  });
  it("BRING_YOUR_OWN_META requires partner-owned", () => {
    expect(isOwnershipAllowed("BRING_YOUR_OWN_META", "PARTNER_OWNED")).toBe(true);
    expect(isOwnershipAllowed("BRING_YOUR_OWN_META", "NEXAFLOW_OWNED")).toBe(false);
  });
  it("HYBRID accepts everything", () => {
    expect(isOwnershipAllowed("HYBRID", "NEXAFLOW_OWNED")).toBe(true);
    expect(isOwnershipAllowed("HYBRID", "PARTNER_OWNED")).toBe(true);
    expect(isOwnershipAllowed("HYBRID", "CUSTOMER_OWNED")).toBe(true);
  });
});

describe("isPartnerFundedSource", () => {
  it("partner wallet + partner credit line are partner-funded", () => {
    expect(isPartnerFundedSource("PARTNER_WALLET")).toBe(true);
    expect(isPartnerFundedSource("PARTNER_CREDIT_LINE")).toBe(true);
  });
  it("customer sources are not", () => {
    expect(isPartnerFundedSource("CUSTOMER_WALLET")).toBe(false);
    expect(isPartnerFundedSource("CUSTOMER_CREDIT_LINE")).toBe(false);
  });
});

describe("assertValidPartnerModelConfig", () => {
  it("accepts a valid RESELLER customer (NexaFlow provider, customer wallet)", () => {
    expect(() =>
      assertValidPartnerModelConfig({
        partnerModel: "RESELLER",
        providerOwnership: "NEXAFLOW_OWNED",
        creditSource: "CUSTOMER_WALLET",
      }),
    ).not.toThrow();
  });

  it("rejects a RESELLER customer on a partner-owned provider", () => {
    expect(() =>
      assertValidPartnerModelConfig({
        partnerModel: "RESELLER",
        providerOwnership: "PARTNER_OWNED",
        creditSource: "CUSTOMER_WALLET",
      }),
    ).toThrow(/not allowed under a RESELLER/);
  });

  it("accepts BRING_YOUR_OWN_META with partner-owned provider", () => {
    expect(() =>
      assertValidPartnerModelConfig({
        partnerModel: "BRING_YOUR_OWN_META",
        providerOwnership: "PARTNER_OWNED",
        creditSource: "CUSTOMER_WALLET",
      }),
    ).not.toThrow();
  });

  it("HYBRID allows a customer-owned WABA", () => {
    expect(() =>
      assertValidPartnerModelConfig({
        partnerModel: "HYBRID",
        providerOwnership: "CUSTOMER_OWNED",
        creditSource: "CUSTOMER_WALLET",
      }),
    ).not.toThrow();
  });

  it("partner-funded credit requires margin enabled", () => {
    expect(() =>
      assertValidPartnerModelConfig({
        partnerModel: "RESELLER",
        providerOwnership: "NEXAFLOW_OWNED",
        creditSource: "PARTNER_CREDIT_LINE",
        partnerMarginEnabled: false,
      }),
    ).toThrow(/margin\/credit enabled/i);
  });

  it("partner-funded credit allowed when margin enabled", () => {
    expect(() =>
      assertValidPartnerModelConfig({
        partnerModel: "RESELLER",
        providerOwnership: "NEXAFLOW_OWNED",
        creditSource: "PARTNER_WALLET",
        partnerMarginEnabled: true,
      }),
    ).not.toThrow();
  });

  it("customer-funded credit never needs partner margin", () => {
    expect(() =>
      assertValidPartnerModelConfig({
        partnerModel: "RESELLER",
        providerOwnership: "NEXAFLOW_OWNED",
        creditSource: "CUSTOMER_WALLET",
        partnerMarginEnabled: false,
      }),
    ).not.toThrow();
  });
});

describe("defaultCustomerConfigFor", () => {
  it("BRING_YOUR_OWN_META defaults to partner-owned provider", () => {
    expect(defaultCustomerConfigFor("BRING_YOUR_OWN_META")).toEqual({
      providerOwnership: "PARTNER_OWNED",
      creditSource: "CUSTOMER_WALLET",
    });
  });
  it("RESELLER + HYBRID default to NexaFlow-owned + customer wallet", () => {
    expect(defaultCustomerConfigFor("RESELLER")).toEqual({
      providerOwnership: "NEXAFLOW_OWNED",
      creditSource: "CUSTOMER_WALLET",
    });
    expect(defaultCustomerConfigFor("HYBRID")).toEqual({
      providerOwnership: "NEXAFLOW_OWNED",
      creditSource: "CUSTOMER_WALLET",
    });
  });
});
