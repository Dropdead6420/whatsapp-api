import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseSignatureHeader,
  verifyStripeWebhookSignature,
} from "./stripe";

const SECRET = "whsec_test_super_secret_do_not_use_in_prod";
const PRIOR_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  if (PRIOR_SECRET === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = PRIOR_SECRET;
});

function signFor(ts: number, body: string): string {
  return crypto
    .createHmac("sha256", SECRET)
    .update(`${ts}.${body}`)
    .digest("hex");
}

const NOW = 1_700_000_000_000; // 2023-11-14 ms epoch
const TS_SECONDS = Math.floor(NOW / 1000);

describe("parseSignatureHeader", () => {
  it("extracts t + v1 from the standard form", () => {
    const parsed = parseSignatureHeader(
      `t=${TS_SECONDS},v1=abcdef,v0=oldhash`,
    );
    expect(parsed).toEqual({
      timestamp: String(TS_SECONDS),
      timestampMs: NOW,
      v1Signatures: ["abcdef"],
    });
  });

  it("collects multiple v1 candidates (key-rotation window)", () => {
    const parsed = parseSignatureHeader(
      `t=${TS_SECONDS},v1=sigA,v1=sigB`,
    );
    expect(parsed?.v1Signatures).toEqual(["sigA", "sigB"]);
  });

  it("returns null when no t= present", () => {
    expect(parseSignatureHeader("v1=abcdef")).toBeNull();
  });

  it("returns null when no v1 present", () => {
    expect(parseSignatureHeader(`t=${TS_SECONDS},v0=old`)).toBeNull();
  });

  it("returns null on a non-numeric timestamp", () => {
    expect(parseSignatureHeader(`t=nope,v1=abc`)).toBeNull();
  });
});

describe("verifyStripeWebhookSignature", () => {
  const body = '{"id":"evt_123","type":"payment_intent.succeeded"}';

  it("returns true for a correctly signed body within the tolerance window", () => {
    const sig = signFor(TS_SECONDS, body);
    expect(
      verifyStripeWebhookSignature({
        rawBody: body,
        signatureHeader: `t=${TS_SECONDS},v1=${sig}`,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("returns false when the body was tampered with", () => {
    const sig = signFor(TS_SECONDS, body);
    const tampered = body.replace("evt_123", "evt_evil");
    expect(
      verifyStripeWebhookSignature({
        rawBody: tampered,
        signatureHeader: `t=${TS_SECONDS},v1=${sig}`,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("returns false when the signature header is missing", () => {
    expect(
      verifyStripeWebhookSignature({
        rawBody: body,
        signatureHeader: undefined,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("returns false when the secret is unset", () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const sig = signFor(TS_SECONDS, body);
    expect(
      verifyStripeWebhookSignature({
        rawBody: body,
        signatureHeader: `t=${TS_SECONDS},v1=${sig}`,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("rejects signatures older than the 5-minute tolerance (replay defense)", () => {
    const sig = signFor(TS_SECONDS, body);
    const sixMinutesLater = NOW + 6 * 60 * 1000;
    expect(
      verifyStripeWebhookSignature({
        rawBody: body,
        signatureHeader: `t=${TS_SECONDS},v1=${sig}`,
        now: sixMinutesLater,
      }),
    ).toBe(false);
  });

  it("rejects future-dated signatures more than 5 minutes ahead", () => {
    const sig = signFor(TS_SECONDS, body);
    const sixMinutesEarlier = NOW - 6 * 60 * 1000;
    expect(
      verifyStripeWebhookSignature({
        rawBody: body,
        signatureHeader: `t=${TS_SECONDS},v1=${sig}`,
        now: sixMinutesEarlier,
      }),
    ).toBe(false);
  });

  it("accepts a signature exactly at the 5-minute boundary", () => {
    const sig = signFor(TS_SECONDS, body);
    const exactlyFiveLater = NOW + 5 * 60 * 1000;
    expect(
      verifyStripeWebhookSignature({
        rawBody: body,
        signatureHeader: `t=${TS_SECONDS},v1=${sig}`,
        now: exactlyFiveLater,
      }),
    ).toBe(true);
  });

  it("matches when at least one of multiple v1 sigs is correct (rotation)", () => {
    const correct = signFor(TS_SECONDS, body);
    expect(
      verifyStripeWebhookSignature({
        rawBody: body,
        signatureHeader: `t=${TS_SECONDS},v1=wrong,v1=${correct}`,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("rejects when all v1 sigs are wrong", () => {
    expect(
      verifyStripeWebhookSignature({
        rawBody: body,
        signatureHeader: `t=${TS_SECONDS},v1=wrong1,v1=wrong2`,
        now: NOW,
      }),
    ).toBe(false);
  });
});
