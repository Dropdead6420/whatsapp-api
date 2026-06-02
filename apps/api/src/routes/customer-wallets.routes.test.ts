// Schema tests for the customer self-recharge route. Mirrors the
// zod schema inline so the test stays fast — no Express graph or
// Prisma client imported.

import { describe, expect, it } from "vitest";
import { z } from "zod";

const rechargeSchema = z.object({
  amount: z.number().int().positive(),
  currency: z
    .string()
    .trim()
    .min(3)
    .max(3)
    .regex(/^[A-Z]{3}$/i, "Currency must be a 3-letter ISO code")
    .optional(),
  idempotencyKey: z.string().min(8).max(80),
  gateway: z.enum(["RAZORPAY"]).default("RAZORPAY"),
});

describe("rechargeSchema", () => {
  const baseValidBody = {
    amount: 50_000,
    idempotencyKey: "recharge_test_001",
  };

  it("accepts the minimal valid body", () => {
    const parsed = rechargeSchema.parse(baseValidBody);
    expect(parsed.gateway).toBe("RAZORPAY"); // default
    expect(parsed.amount).toBe(50_000);
  });

  it("rejects non-integer amount (fractional paise are invalid)", () => {
    expect(() =>
      rechargeSchema.parse({ ...baseValidBody, amount: 100.5 }),
    ).toThrow();
  });

  it("rejects zero / negative amount", () => {
    expect(() =>
      rechargeSchema.parse({ ...baseValidBody, amount: 0 }),
    ).toThrow();
    expect(() =>
      rechargeSchema.parse({ ...baseValidBody, amount: -100 }),
    ).toThrow();
  });

  it("rejects short idempotency keys (<8)", () => {
    expect(() =>
      rechargeSchema.parse({ ...baseValidBody, idempotencyKey: "short1" }),
    ).toThrow();
  });

  it("rejects long idempotency keys (>80)", () => {
    expect(() =>
      rechargeSchema.parse({ ...baseValidBody, idempotencyKey: "x".repeat(81) }),
    ).toThrow();
  });

  it("accepts a 3-letter ISO currency code", () => {
    const parsed = rechargeSchema.parse({ ...baseValidBody, currency: "INR" });
    expect(parsed.currency).toBe("INR");
  });

  it("rejects malformed currency", () => {
    expect(() =>
      rechargeSchema.parse({ ...baseValidBody, currency: "INDIA" }),
    ).toThrow();
    expect(() =>
      rechargeSchema.parse({ ...baseValidBody, currency: "US" }),
    ).toThrow();
  });

  it("rejects unknown gateway", () => {
    expect(() =>
      rechargeSchema.parse({ ...baseValidBody, gateway: "PAYPAL" }),
    ).toThrow();
  });

  it("strips arbitrary unknown fields (defense against spoofing tenantId)", () => {
    const parsed = rechargeSchema.parse({
      ...baseValidBody,
      tenantId: "evil",
      walletId: "evil",
      status: "SUCCEEDED",
    });
    expect("tenantId" in parsed).toBe(false);
    expect("walletId" in parsed).toBe(false);
    expect("status" in parsed).toBe(false);
  });
});
