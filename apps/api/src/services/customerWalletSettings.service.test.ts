import { describe, expect, it } from "vitest";
import { sanitizeCustomerWalletSettings } from "./customerWalletSettings.service";

describe("sanitizeCustomerWalletSettings", () => {
  it("returns an empty patch for an empty input (nothing changes)", () => {
    expect(sanitizeCustomerWalletSettings({})).toEqual({});
  });

  it("only returns keys that were supplied (omitted = unchanged)", () => {
    const patch = sanitizeCustomerWalletSettings({ lowBalanceThreshold: 250 });
    expect(patch).toEqual({ lowBalanceThreshold: 250 });
    expect("autoRechargeEnabled" in patch).toBe(false);
  });

  it("accepts a valid full auto-recharge config", () => {
    const patch = sanitizeCustomerWalletSettings({
      lowBalanceThreshold: 500,
      autoRechargeEnabled: true,
      autoRechargeAmountCredits: 5000,
      autoRechargePaymentProvider: "razorpay",
      autoRechargePaymentMethodToken: "pm_abc123",
    });
    expect(patch).toEqual({
      lowBalanceThreshold: 500,
      autoRechargeEnabled: true,
      autoRechargeAmountCredits: 5000,
      autoRechargePaymentProvider: "razorpay",
      autoRechargePaymentMethodToken: "pm_abc123",
    });
  });

  // ---- field whitelisting: the whole point of this helper ----
  it("silently drops admin-only fields (status/billingMode/creditLimit)", () => {
    const patch = sanitizeCustomerWalletSettings({
      lowBalanceThreshold: 100,
      // @ts-expect-error — these aren't in the input type; a malicious
      // client could still send them in the raw body.
      status: "SUSPENDED",
      billingMode: "POSTPAID",
      creditLimit: 999999,
    });
    expect(patch).toEqual({ lowBalanceThreshold: 100 });
    expect("status" in patch).toBe(false);
    expect("billingMode" in patch).toBe(false);
    expect("creditLimit" in patch).toBe(false);
  });

  // ---- lowBalanceThreshold ----
  it("rejects negative / non-integer thresholds", () => {
    expect(() =>
      sanitizeCustomerWalletSettings({ lowBalanceThreshold: -1 }),
    ).toThrow(/non-negative integer/i);
    expect(() =>
      sanitizeCustomerWalletSettings({ lowBalanceThreshold: 10.5 }),
    ).toThrow(/non-negative integer/i);
  });

  it("accepts zero threshold (disables the low-balance alert)", () => {
    expect(sanitizeCustomerWalletSettings({ lowBalanceThreshold: 0 })).toEqual({
      lowBalanceThreshold: 0,
    });
  });

  it("rejects an absurdly large threshold", () => {
    expect(() =>
      sanitizeCustomerWalletSettings({ lowBalanceThreshold: 1_000_000_000 }),
    ).toThrow(/maximum/i);
  });

  // ---- autoRechargeEnabled ----
  it("rejects a non-boolean enabled flag", () => {
    expect(() =>
      sanitizeCustomerWalletSettings({ autoRechargeEnabled: "yes" }),
    ).toThrow(/boolean/i);
  });

  // ---- provider ----
  it("accepts razorpay / stripe / null providers", () => {
    expect(
      sanitizeCustomerWalletSettings({ autoRechargePaymentProvider: "razorpay" })
        .autoRechargePaymentProvider,
    ).toBe("razorpay");
    expect(
      sanitizeCustomerWalletSettings({ autoRechargePaymentProvider: "stripe" })
        .autoRechargePaymentProvider,
    ).toBe("stripe");
    expect(
      sanitizeCustomerWalletSettings({ autoRechargePaymentProvider: null })
        .autoRechargePaymentProvider,
    ).toBeNull();
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      sanitizeCustomerWalletSettings({ autoRechargePaymentProvider: "paypal" }),
    ).toThrow(/razorpay.*stripe.*null/i);
  });

  // ---- token ----
  it("trims a valid token and accepts null", () => {
    expect(
      sanitizeCustomerWalletSettings({
        autoRechargePaymentMethodToken: "  tok_1  ",
      }).autoRechargePaymentMethodToken,
    ).toBe("tok_1");
    expect(
      sanitizeCustomerWalletSettings({ autoRechargePaymentMethodToken: null })
        .autoRechargePaymentMethodToken,
    ).toBeNull();
  });

  it("rejects an empty-string token", () => {
    expect(() =>
      sanitizeCustomerWalletSettings({ autoRechargePaymentMethodToken: "   " }),
    ).toThrow(/non-empty/i);
  });

  // ---- cross-field guard ----
  it("rejects enabling auto-recharge with a zero amount in the same patch", () => {
    expect(() =>
      sanitizeCustomerWalletSettings({
        autoRechargeEnabled: true,
        autoRechargeAmountCredits: 0,
      }),
    ).toThrow(/greater than 0/i);
  });

  it("allows enabling without amount in the patch (route does the merged-state check)", () => {
    // The helper can't see already-persisted fields, so enabling
    // without an amount here is fine — the route's merged-state guard
    // catches the truly-incomplete case.
    expect(() =>
      sanitizeCustomerWalletSettings({ autoRechargeEnabled: true }),
    ).not.toThrow();
  });
});
