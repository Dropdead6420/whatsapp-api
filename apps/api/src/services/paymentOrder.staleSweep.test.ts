import { describe, expect, it } from "vitest";
import {
  STALE_ORDER_THRESHOLD_HOURS,
  isStalePaymentOrder,
} from "./paymentOrder.service";

const now = new Date("2026-06-03T12:00:00Z");
function hoursAgo(h: number): Date {
  return new Date(now.getTime() - h * 60 * 60 * 1000);
}

describe("isStalePaymentOrder", () => {
  it("default threshold is 24h", () => {
    expect(STALE_ORDER_THRESHOLD_HOURS).toBe(24);
  });

  it("PENDING older than threshold is stale", () => {
    expect(
      isStalePaymentOrder(
        { status: "PENDING", createdAt: hoursAgo(25) },
        now,
      ),
    ).toBe(true);
  });

  it("CREATED older than threshold is stale", () => {
    expect(
      isStalePaymentOrder(
        { status: "CREATED", createdAt: hoursAgo(48) },
        now,
      ),
    ).toBe(true);
  });

  it("exactly at the threshold boundary is stale (>=)", () => {
    expect(
      isStalePaymentOrder(
        { status: "PENDING", createdAt: hoursAgo(24) },
        now,
      ),
    ).toBe(true);
  });

  it("PENDING younger than threshold is NOT stale (webhook may still arrive)", () => {
    expect(
      isStalePaymentOrder(
        { status: "PENDING", createdAt: hoursAgo(2) },
        now,
      ),
    ).toBe(false);
  });

  it("terminal states are never stale even when ancient", () => {
    for (const status of ["SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"] as const) {
      expect(
        isStalePaymentOrder({ status, createdAt: hoursAgo(1000) }, now),
      ).toBe(false);
    }
  });

  it("respects a custom threshold", () => {
    const order = { status: "PENDING" as const, createdAt: hoursAgo(5) };
    expect(isStalePaymentOrder(order, now, 4)).toBe(true);
    expect(isStalePaymentOrder(order, now, 6)).toBe(false);
  });

  it("a freshly-created order is never stale", () => {
    expect(
      isStalePaymentOrder({ status: "CREATED", createdAt: now }, now),
    ).toBe(false);
  });
});
