import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAYMENT_GATEWAYS,
  DEFAULT_PAYMENT_NOTIFICATIONS,
  mergeGatewaySettings,
  mergeNotificationTemplates,
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

describe("payment settings defaults", () => {
  it("ships all screenshot gateway rows and overlays stored values", () => {
    const merged = mergeGatewaySettings([
      {
        gateway: "RAZORPAY",
        label: "Razorpay",
        description: "custom",
        enabled: true,
        mode: "live",
        credentialHint: "hint",
        instructions: "ready",
      },
    ]);

    expect(merged.map((item) => item.gateway)).toEqual(
      DEFAULT_PAYMENT_GATEWAYS.map((item) => item.gateway),
    );
    expect(merged.find((item) => item.gateway === "RAZORPAY")).toMatchObject({
      enabled: true,
      mode: "live",
      instructions: "ready",
    });
    expect(merged.find((item) => item.gateway === "STRIPE")?.enabled).toBe(false);
  });

  it("ships payment notification templates and overlays stored copy", () => {
    const merged = mergeNotificationTemplates([
      {
        event: "PAYMENT_SUCCESS",
        label: "Payment success",
        description: "saved",
        enabled: false,
        subject: "Saved subject",
        message: "Saved body",
      },
    ]);

    expect(merged.map((item) => item.event)).toEqual(
      DEFAULT_PAYMENT_NOTIFICATIONS.map((item) => item.event),
    );
    expect(merged.find((item) => item.event === "PAYMENT_SUCCESS")).toMatchObject({
      enabled: false,
      subject: "Saved subject",
      message: "Saved body",
    });
  });
});
