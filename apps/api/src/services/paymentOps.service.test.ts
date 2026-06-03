import { describe, expect, it } from "vitest";
import {
  parsePaymentOrderFilters,
  parsePaymentWebhookFilters,
} from "./paymentOps.service";

describe("parsePaymentOrderFilters", () => {
  it("defaults to limit 50 + no filters on empty query", () => {
    expect(parsePaymentOrderFilters({})).toEqual({
      status: undefined,
      gateway: undefined,
      tenantId: undefined,
      limit: 50,
    });
  });

  it("accepts valid status + gateway", () => {
    const f = parsePaymentOrderFilters({ status: "SUCCEEDED", gateway: "STRIPE" });
    expect(f.status).toBe("SUCCEEDED");
    expect(f.gateway).toBe("STRIPE");
  });

  it("uppercases enum values (case-insensitive query params)", () => {
    const f = parsePaymentOrderFilters({ status: "pending", gateway: "razorpay" });
    expect(f.status).toBe("PENDING");
    expect(f.gateway).toBe("RAZORPAY");
  });

  it("drops unknown enum values instead of throwing", () => {
    const f = parsePaymentOrderFilters({ status: "BOGUS", gateway: "PAYPAL" });
    expect(f.status).toBeUndefined();
    expect(f.gateway).toBeUndefined();
  });

  it("trims tenantId + ignores empty", () => {
    expect(parsePaymentOrderFilters({ tenantId: "  t_1  " }).tenantId).toBe("t_1");
    expect(parsePaymentOrderFilters({ tenantId: "   " }).tenantId).toBeUndefined();
  });

  it("clamps limit to [1, 200]", () => {
    expect(parsePaymentOrderFilters({ limit: "9999" }).limit).toBe(200);
    expect(parsePaymentOrderFilters({ limit: "0" }).limit).toBe(1);
    expect(parsePaymentOrderFilters({ limit: "abc" }).limit).toBe(50);
    expect(parsePaymentOrderFilters({ limit: "25" }).limit).toBe(25);
  });

  it("recognizes EXPIRED (the sweep-set terminal status)", () => {
    expect(parsePaymentOrderFilters({ status: "expired" }).status).toBe("EXPIRED");
  });
});

describe("parsePaymentWebhookFilters", () => {
  it("defaults to limit 50 + no filters", () => {
    expect(parsePaymentWebhookFilters({})).toEqual({
      gateway: undefined,
      signatureStatus: undefined,
      paymentOrderId: undefined,
      limit: 50,
    });
  });

  it("accepts valid signatureStatus", () => {
    for (const s of ["VALID", "INVALID", "MISSING"]) {
      expect(parsePaymentWebhookFilters({ signatureStatus: s }).signatureStatus).toBe(s);
    }
  });

  it("uppercases + drops unknown signatureStatus", () => {
    expect(
      parsePaymentWebhookFilters({ signatureStatus: "valid" }).signatureStatus,
    ).toBe("VALID");
    expect(
      parsePaymentWebhookFilters({ signatureStatus: "garbled" }).signatureStatus,
    ).toBeUndefined();
  });

  it("passes through a paymentOrderId filter", () => {
    expect(
      parsePaymentWebhookFilters({ paymentOrderId: "po_42" }).paymentOrderId,
    ).toBe("po_42");
  });

  it("clamps limit", () => {
    expect(parsePaymentWebhookFilters({ limit: "500" }).limit).toBe(200);
  });
});
