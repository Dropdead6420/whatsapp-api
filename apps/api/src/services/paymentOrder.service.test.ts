import { describe, expect, it } from "vitest";
import {
  assertCanTransitionStatus,
  canTransitionStatus,
  isTerminalStatus,
  sanitizeIdempotencyKey,
  sanitizeRechargeAmount,
} from "./paymentOrder.service";

describe("canTransitionStatus", () => {
  it("CREATED → PENDING is allowed (gateway returned, awaiting checkout)", () => {
    expect(canTransitionStatus("CREATED", "PENDING")).toBe(true);
  });

  it("PENDING → SUCCEEDED is allowed (happy path)", () => {
    expect(canTransitionStatus("PENDING", "SUCCEEDED")).toBe(true);
  });

  it("PENDING → FAILED is allowed (gateway rejected)", () => {
    expect(canTransitionStatus("PENDING", "FAILED")).toBe(true);
  });

  it("PENDING → EXPIRED is allowed (reconciliation sweep)", () => {
    expect(canTransitionStatus("PENDING", "EXPIRED")).toBe(true);
  });

  it("CREATED → CANCELLED is allowed (operator-cancel before checkout)", () => {
    expect(canTransitionStatus("CREATED", "CANCELLED")).toBe(true);
  });

  it("self-transitions are forbidden (X → X)", () => {
    for (const s of ["CREATED", "PENDING", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"] as const) {
      expect(canTransitionStatus(s, s)).toBe(false);
    }
  });

  it("SUCCEEDED → anything is forbidden (terminal, would unbook a credit)", () => {
    for (const target of ["CREATED", "PENDING", "FAILED", "CANCELLED", "EXPIRED"] as const) {
      expect(canTransitionStatus("SUCCEEDED", target)).toBe(false);
    }
  });

  it("FAILED → anything is forbidden (terminal)", () => {
    for (const target of ["CREATED", "PENDING", "SUCCEEDED", "CANCELLED", "EXPIRED"] as const) {
      expect(canTransitionStatus("FAILED", target)).toBe(false);
    }
  });

  it("CANCELLED → anything is forbidden (terminal)", () => {
    for (const target of ["CREATED", "PENDING", "SUCCEEDED", "FAILED", "EXPIRED"] as const) {
      expect(canTransitionStatus("CANCELLED", target)).toBe(false);
    }
  });

  it("EXPIRED → anything is forbidden (terminal)", () => {
    for (const target of ["CREATED", "PENDING", "SUCCEEDED", "FAILED", "CANCELLED"] as const) {
      expect(canTransitionStatus("EXPIRED", target)).toBe(false);
    }
  });

  it("PENDING → CREATED is forbidden (caller must create a fresh order)", () => {
    expect(canTransitionStatus("PENDING", "CREATED")).toBe(false);
  });
});

describe("assertCanTransitionStatus", () => {
  it("throws on forbidden transitions", () => {
    expect(() => assertCanTransitionStatus("SUCCEEDED", "FAILED")).toThrow(
      /transition/i,
    );
  });

  it("does not throw on allowed transitions", () => {
    expect(() => assertCanTransitionStatus("PENDING", "SUCCEEDED")).not.toThrow();
  });
});

describe("isTerminalStatus", () => {
  it("SUCCEEDED / FAILED / CANCELLED / EXPIRED are terminal", () => {
    expect(isTerminalStatus("SUCCEEDED")).toBe(true);
    expect(isTerminalStatus("FAILED")).toBe(true);
    expect(isTerminalStatus("CANCELLED")).toBe(true);
    expect(isTerminalStatus("EXPIRED")).toBe(true);
  });

  it("CREATED / PENDING are not terminal", () => {
    expect(isTerminalStatus("CREATED")).toBe(false);
    expect(isTerminalStatus("PENDING")).toBe(false);
  });
});

describe("sanitizeRechargeAmount", () => {
  it("accepts the minimum valid amount", () => {
    expect(sanitizeRechargeAmount(100)).toBe(100);
  });

  it("accepts a typical amount", () => {
    expect(sanitizeRechargeAmount(50_000)).toBe(50_000);
  });

  it("rejects non-integer values (fractional paise / cents are invalid)", () => {
    expect(() => sanitizeRechargeAmount(99.5)).toThrow(/integer/i);
  });

  it("rejects below-minimum amounts", () => {
    expect(() => sanitizeRechargeAmount(50)).toThrow(/at least/i);
    expect(() => sanitizeRechargeAmount(0)).toThrow(/at least/i);
  });

  it("rejects negative amounts", () => {
    expect(() => sanitizeRechargeAmount(-1000)).toThrow(/at least/i);
  });

  it("rejects above-ceiling amounts (defense in depth against a typo in the form)", () => {
    expect(() => sanitizeRechargeAmount(100_000_000)).toThrow(/exceed/i);
  });

  it("rejects NaN", () => {
    expect(() => sanitizeRechargeAmount(NaN)).toThrow(/number/i);
  });

  it("rejects non-numeric strings", () => {
    expect(() => sanitizeRechargeAmount("not-a-number")).toThrow(/number/i);
  });

  it("accepts numeric strings (parsed via Number())", () => {
    expect(sanitizeRechargeAmount("5000")).toBe(5000);
  });
});

describe("sanitizeIdempotencyKey", () => {
  it("accepts a typical UUID-ish key", () => {
    expect(sanitizeIdempotencyKey("recharge_2026_06_02_user42_abc")).toBe(
      "recharge_2026_06_02_user42_abc",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeIdempotencyKey("  some_key_001  ")).toBe("some_key_001");
  });

  it("rejects non-string input", () => {
    expect(() => sanitizeIdempotencyKey(null)).toThrow(/required/i);
    expect(() => sanitizeIdempotencyKey(undefined)).toThrow(/required/i);
    expect(() => sanitizeIdempotencyKey(123)).toThrow(/required/i);
  });

  it("rejects too-short keys (a 7-char key isn't enough entropy)", () => {
    expect(() => sanitizeIdempotencyKey("short99")).toThrow(/at least/i);
  });

  it("rejects too-long keys (>80)", () => {
    expect(() => sanitizeIdempotencyKey("x".repeat(81))).toThrow(/80/);
  });

  it("rejects forbidden characters (only [A-Za-z0-9_-])", () => {
    expect(() => sanitizeIdempotencyKey("with spaces 123")).toThrow();
    expect(() => sanitizeIdempotencyKey("path/style/key")).toThrow();
    expect(() => sanitizeIdempotencyKey("key+with+plus")).toThrow();
  });

  it("accepts the full allowed alphabet", () => {
    const key = "ABCabc_123-XYZ_xyz";
    expect(sanitizeIdempotencyKey(key)).toBe(key);
  });
});
