// Pure-helper tests for the Razorpay webhook layer.
//
// The DB-touching path (handleRazorpayEvent) is integration territory
// — exercised via a future end-to-end test once we have a Razorpay
// sandbox in CI. This file pins the bits that are pure logic:
//   - extractEventId: which field is canonical per event type
//   - verifyRazorpayWebhookSignature: HMAC correctness + timing-safe
//     handling of mismatched lengths + missing secret

import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyRazorpayWebhookSignature } from "../lib/razorpay";
import { extractEventId } from "./razorpayWebhook.service";

const SECRET = "test-webhook-secret-do-not-use-in-prod";
const PRIOR_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

beforeEach(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  if (PRIOR_SECRET === undefined) {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  } else {
    process.env.RAZORPAY_WEBHOOK_SECRET = PRIOR_SECRET;
  }
});

function sign(body: string): string {
  return crypto.createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("extractEventId", () => {
  it("prefers payment entity id for payment.captured", () => {
    const id = extractEventId({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_abc123",
            order_id: "order_x",
            amount: 50000,
            currency: "INR",
            status: "captured",
          },
        },
      },
    });
    expect(id).toBe("pay_abc123");
  });

  it("prefers payment entity id for payment.failed", () => {
    const id = extractEventId({
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: "pay_failed_123",
            order_id: "order_y",
            amount: 100,
            currency: "INR",
            status: "failed",
            error_description: "Card declined",
          },
        },
      },
    });
    expect(id).toBe("pay_failed_123");
  });

  it("falls back to order entity id when no payment present", () => {
    const id = extractEventId({
      event: "order.paid",
      payload: {
        order: { entity: { id: "order_only_42", amount: 50000, status: "paid" } },
      },
    });
    expect(id).toBe("order_only_42");
  });

  it("returns null when neither payment nor order is present", () => {
    expect(extractEventId({ event: "weird", payload: {} })).toBeNull();
  });
});

describe("verifyRazorpayWebhookSignature", () => {
  const body = '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_test"}}}}';

  it("returns true for a correctly signed body", () => {
    expect(
      verifyRazorpayWebhookSignature({
        rawBody: body,
        signatureHeader: sign(body),
      }),
    ).toBe(true);
  });

  it("returns false when the body was tampered with", () => {
    const tampered = body.replace("pay_test", "pay_attacker");
    expect(
      verifyRazorpayWebhookSignature({
        rawBody: tampered,
        signatureHeader: sign(body),
      }),
    ).toBe(false);
  });

  it("returns false when the signature header is missing", () => {
    expect(
      verifyRazorpayWebhookSignature({
        rawBody: body,
        signatureHeader: undefined,
      }),
    ).toBe(false);
  });

  it("returns false when secret is unset (defense in depth, never accept)", () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    expect(
      verifyRazorpayWebhookSignature({
        rawBody: body,
        signatureHeader: sign(body),
      }),
    ).toBe(false);
  });

  it("returns false on a signature of the wrong length (timingSafeEqual buffer-length guard)", () => {
    expect(
      verifyRazorpayWebhookSignature({
        rawBody: body,
        signatureHeader: "shortgarbage",
      }),
    ).toBe(false);
  });

  it("returns false on an entirely wrong same-length signature", () => {
    const bogus = "a".repeat(64);
    expect(
      verifyRazorpayWebhookSignature({
        rawBody: body,
        signatureHeader: bogus,
      }),
    ).toBe(false);
  });
});
