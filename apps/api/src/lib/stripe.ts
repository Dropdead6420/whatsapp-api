// ============================================================================
// Stripe HTTP client (Claude FINAL §4, slice 13)
//
// Mirrors lib/razorpay.ts — zero-dep fetch wrapper for the two
// endpoints we actually need (Payment Intents create + webhook
// signature verification). Avoids the official `stripe` SDK because
// it's a 6-MB transitive tree and we use < 1% of its surface.
//
// Stripe's webhook signature is the trickier of the two gateways:
// the header is `Stripe-Signature: t=<ts>,v1=<hex>,v0=<hex>`, and
// the signed payload is the timestamp concatenated with the raw
// body (`{ts}.{rawBody}`). We accept v1 only — v0 was deprecated.
//
// Configuration:
//   STRIPE_SECRET_KEY      — required for live order create
//   STRIPE_WEBHOOK_SECRET  — required by the webhook handler
// ============================================================================

import crypto from "node:crypto";

export interface StripePaymentIntentRequest {
  /** Smallest currency unit (cents). Integer. */
  amount: number;
  currency: string;
  /** Idempotency key — Stripe collapses duplicate creates on this. */
  idempotencyKey: string;
  /** Free-form metadata Stripe echoes back. <= 50 keys, <= 500 chars each. */
  metadata?: Record<string, string>;
}

export interface StripePaymentIntentResponse {
  id: string;
  amount: number;
  currency: string;
  status: string;
  client_secret: string;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * POST https://api.stripe.com/v1/payment_intents. Returns the parsed
 * PaymentIntent. In stub mode (no key), returns a deterministic fake
 * so dev/test envs don't need secrets.
 */
export async function createStripePaymentIntent(
  req: StripePaymentIntentRequest,
): Promise<StripePaymentIntentResponse> {
  if (!isStripeConfigured()) {
    const fakeId = `pi_stub_${crypto.randomBytes(8).toString("hex")}`;
    return {
      id: fakeId,
      amount: req.amount,
      currency: req.currency.toLowerCase(),
      status: "requires_payment_method",
      client_secret: `${fakeId}_secret_stub`,
    };
  }

  // Stripe form-encodes everything (legacy API). Build the body
  // manually — URLSearchParams handles encoding for us.
  const form = new URLSearchParams();
  form.set("amount", String(req.amount));
  // Stripe wants lowercase currency codes.
  form.set("currency", req.currency.toLowerCase());
  form.set("automatic_payment_methods[enabled]", "true");
  if (req.metadata) {
    for (const [k, v] of Object.entries(req.metadata)) {
      form.set(`metadata[${k}]`, v);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
    // Idempotency-Key is the Stripe-side guard against double-create
    // when the client retries.
    "Idempotency-Key": req.idempotencyKey,
  };

  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers,
    body: form.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Stripe /payment_intents failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as StripePaymentIntentResponse;
}

/**
 * Verifies the `Stripe-Signature` header. Returns true iff the v1
 * signature matches an HMAC-SHA256 of `{ts}.{rawBody}` with the
 * webhook secret.
 *
 * Tolerance: rejects timestamps older than 5 minutes (Stripe's
 * default) to defeat replay attacks. Use args.now to make the
 * timestamp check deterministic in tests.
 */
export function verifyStripeWebhookSignature(args: {
  rawBody: string;
  signatureHeader: string | undefined;
  now?: number;
}): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !args.signatureHeader) return false;
  const parsed = parseSignatureHeader(args.signatureHeader);
  if (!parsed) return false;

  // Replay defense: reject signatures older than the tolerance.
  const now = args.now ?? Date.now();
  const TOLERANCE_MS = 5 * 60 * 1000;
  if (Math.abs(now - parsed.timestampMs) > TOLERANCE_MS) return false;

  const signedPayload = `${parsed.timestamp}.${args.rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "utf-8");

  // Any matching v1 candidate is enough (Stripe rotates by sending
  // both old + new signatures during a rollover).
  return parsed.v1Signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, "utf-8");
    if (sigBuf.length !== expectedBuf.length) return false;
    try {
      return crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  });
}

interface ParsedStripeSignature {
  timestamp: string;
  timestampMs: number;
  v1Signatures: string[];
}

/**
 * Parses `Stripe-Signature: t=1700000000,v1=abc...,v1=def...,v0=old`.
 * Exported for tests. Returns null on malformed input.
 */
export function parseSignatureHeader(
  header: string,
): ParsedStripeSignature | null {
  const parts = header.split(",");
  let timestamp: string | null = null;
  const v1Signatures: string[] = [];
  for (const raw of parts) {
    const [k, v] = raw.split("=");
    if (!k || !v) continue;
    if (k.trim() === "t") timestamp = v.trim();
    else if (k.trim() === "v1") v1Signatures.push(v.trim());
  }
  if (!timestamp || v1Signatures.length === 0) return null;
  const tsNum = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(tsNum)) return null;
  return {
    timestamp,
    // Stripe sends seconds; convert to ms for our tolerance check.
    timestampMs: tsNum * 1000,
    v1Signatures,
  };
}
